# Telegram-бот «Фото → видео»

> **Актуальная production-схема:** официальный Kling API (`VIDEO_PROVIDER=kling`), Next.js на Vercel, Neon PostgreSQL, Vercel Blob и внешний планировщик cron-job.org. Разделы про Runway ниже относятся только к альтернативному провайдеру (`VIDEO_PROVIDER=runway`). Актуальный процесс разработки и публикации описан в `DEVELOPMENT.md`.

Production-ready MVP на TypeScript и Next.js: принимает фотографию в Telegram, предлагает готовый эффект или свой запрос, запускает асинхронную генерацию через Kling или Runway и отправляет готовый MP4 в чат.

## 1. Назначение проекта

Бот реализует полный сценарий:

1. `/start` — приветствие и инструкция.
2. Пользователь отправляет JPEG или PNG для официального Kling API (WebP доступен только в MOCK и Runway).
3. Выбирает «Естественное движение», «Кинематографичное оживление» или «Свой запрос».
4. Генерация запускается сразу после выбора готового эффекта или отправки своего описания, без отдельного подтверждения.
5. Пользователь сразу получает короткое сообщение о запуске.
6. Готовый MP4 приходит отдельным сообщением после завершения фоновой обработки.
7. При ошибке бот отправляет безопасное сообщение без ключей, URL с токеном и технического ответа провайдера.

Параметры жёстко зафиксированы в `src/lib/domain/prompts.ts` и `src/lib/providers/runway.ts`:

- модель `kling_4_flash` (Kling 4.0 Flash);
- `POST /v1/image_to_video` через официальный `@runwayml/sdk`;
- один исходный кадр `promptImage`;
- `duration: 5`;
- `ratio: "auto_720p"` — 720p с сохранением пропорций исходника;
- ориентировочная стоимость — 47 кредитов Runway без входного видео;
- других моделей и длительностей в интерфейсе нет.

Официальная документация, использованная при реализации:

- [доступные модели](https://docs.dev.runwayml.com/guides/models/);
- [начало работы с API](https://docs.dev.runwayml.com/guides/using-the-api/);
- [требования к изображениям и URL](https://docs.dev.runwayml.com/assets/inputs/);
- [SDK и асинхронные задачи](https://docs.dev.runwayml.com/api-details/sdks/);
- [тарифы](https://docs.dev.runwayml.com/guides/pricing/).

## 2. Возможности MVP

- Русский интерфейс, английские системные части промптов.
- Два готовых эффекта и пользовательское описание движения до 1000 символов.
- Обязательные ограничения на сохранение людей, внешности, пропорций, одежды, фона и композиции добавляются **после** пользовательского текста.
- Команды `/start`, `/help`, `/status`, `/cancel`, `/privacy`.
- Административная `/stats` с проверкой прав на сервере.
- Дневной лимит на пользователя и глобальный лимит активных задач.
- Ограничение частоты запросов в PostgreSQL.
- Проверка размера и реальной сигнатуры JPEG, PNG и WebP.
- Отключение новых генераций через `GENERATIONS_ENABLED=false`.
- Локальный MOCK без Runway и Vercel Blob, с настоящим пятисекундным MP4.
- Идемпотентность Telegram `update_id`, условные переходы статусов и leases для poll/delivery.
- Автоматическое удаление временных исходников после завершения или по TTL.
- Безопасные структурированные логи без промптов, файлов, URL, токенов и персональных данных.

Платежей, подписок, Telegram Stars и денежных балансов нет. Значение 47 кредитов показывается только как справочная оценка и ниоткуда не списывается кодом бота.

## 3. Архитектура и схема обработки

Основная архитектура: **Vercel Pro + Next.js App Router + Telegram webhook + PostgreSQL + Vercel Blob + Vercel Cron**. Отдельный постоянный worker не требуется.

```text
Telegram
   │ POST update + secret header
   ▼
/api/telegram/webhook
   │ транзакция: update_id, пользователь, диалог, черновик
   │ HTTP 200; длительная работа не удерживает webhook
   ▼
waitUntil: скачать фото → проверить → Vercel Blob → создать задачу Runway
   │ provider_task_id сохраняется в PostgreSQL
   ▼
/api/cron/process (каждую минуту, Authorization: Bearer CRON_SECRET)
   │ восстановить CONFIRMED → проверить SUBMITTED/PROCESSING
   │ скачать результат → отправить MP4 → SENT → удалить исходник
   ▼
Telegram / Runway / Blob / PostgreSQL
```

`waitUntil` используется только для короткой подготовки и создания задачи, не для ожидания видео. Завершение отслеживает cron. Повторный cron также восстанавливает задачи, оставшиеся в `CONFIRMED`.

### Статусы

| Статус | Значение |
|---|---|
| `DRAFT` | Фото или готовый промпт сохранены, запуск ещё не подтверждён |
| `WAITING_FOR_PROMPT` | Ожидается свой запрос |
| `CONFIRMED` | Лимиты проверены, место в очереди зарезервировано |
| `UPLOADING` | Идёт скачивание и загрузка исходника, затем вызов Runway |
| `SUBMITTED` | Получен `provider_task_id` |
| `PROCESSING` | Cron проверяет задачу провайдера |
| `SUCCEEDED` | Результат получен, ожидает отправки |
| `SENT` | MP4 отправлен, повторная доставка заблокирована |
| `FAILED` | Безопасная ошибка доступна в БД |
| `CANCELLED` | Отменён черновик или ожидание ввода |

### Идемпотентность и сбои

- `processed_updates.update_id` не позволяет повторному webhook создать второй черновик или сообщение.
- Изменения статусов выполняются условными `UPDATE … WHERE status = …`.
- Глобальное подтверждение сериализуется PostgreSQL advisory lock, поэтому параллельные подтверждения не обходят лимит.
- Poll и delivery получают короткие leases; повторный cron не дублирует работу.
- Дневной лимит считается по `confirmed_at` в UTC. Даже неудачная попытка расходует лимит, поскольку обращение к провайдеру могло быть платным.
- Прерванный `UPLOADING` после таймаута переводится в `FAILED`, а не отправляется повторно вслепую: у Runway нет использованного здесь документированного ключа идемпотентности, и автоматический повтор мог бы создать вторую платную генерацию.
- Строгая exactly-once доставка при падении ровно между ответом Telegram и записью в БД невозможна без идемпотентности самого Telegram. Статусы и leases исключают дубликаты при обычных повторах webhook/cron; такой аварийный случай требует ручной сверки.

Если минутный Vercel Cron недоступен, простейшая альтернатива — внешний планировщик, вызывающий тот же защищённый endpoint. Railway/Render с постоянным worker понадобятся только при больших очередях или длительных пакетных операциях.

## 4. Требования

- Node.js 20.9 или новее и npm.
- Аккаунт GitHub для публикации.
- Аккаунт Vercel; для конфигурации cron каждую минуту — план Pro.
- Telegram-бот, созданный через [@BotFather](https://t.me/BotFather).
- API-ключ Runway с балансом для реального режима.
- PostgreSQL 13+.
- Vercel Blob для production и для реального Runway.
- Для локальной базы проще всего использовать Docker, но он не обязателен при уже установленном PostgreSQL.
- Для локального Telegram webhook — HTTPS-туннель, например `cloudflared`.

MOCK-режиму нужны только Telegram-токен, PostgreSQL и локальные секреты webhook/cron. Ключ Runway и Blob для него не нужны.

## 5. Структура проекта

```text
.
├── assets/mock.mp4                  # локальный пятисекундный MOCK-результат
├── migrations/001_initial.sql       # схема PostgreSQL
├── scripts/
│   ├── migrate.mjs                  # миграции с advisory lock
│   └── telegram-webhook.mjs         # set/info/delete webhook
├── src/
│   ├── app/
│   │   ├── api/cron/process/route.ts
│   │   ├── api/health/route.ts
│   │   └── api/telegram/webhook/route.ts
│   │   ├── layout.tsx
│   │   └── page.tsx
│   └── lib/
│       ├── db/                      # PostgreSQL и in-memory store для тестов
│       ├── domain/                  # типы, промпты, статусы, Store interface
│       ├── providers/runway.ts      # реальный и MOCK provider
│       ├── storage/                 # Blob и локальное MOCK-хранилище
│       ├── telegram/                # grammY handlers, кнопки, тексты
│       ├── config.ts                # проверка env через Zod
│       ├── http.ts                  # ограниченные по размеру downloads
│       ├── images.ts                # сигнатуры изображений
│       ├── jobs.ts                  # submit/poll/deliver/cleanup
│       ├── runtime.ts
│       └── security.ts
├── tests/                           # Vitest, включая полный MOCK-цикл
├── .env.example
├── .gitignore
├── GITHUB.md
├── next.config.ts
├── package.json
├── vercel.json
└── vitest.config.ts
```

## 6. Локальная установка

```bash
git clone https://github.com/USERNAME/REPOSITORY.git
cd REPOSITORY
npm ci
cp .env.example .env
```

Windows Command Prompt вместо `cp`:

```bat
copy .env.example .env
```

Запуск локального PostgreSQL в Docker:

```bash
docker run --name photo-video-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=photo_video_bot -p 5432:5432 -d postgres:16
```

Если контейнер уже существует:

```bash
docker start photo-video-db
```

Сгенерировать независимые секреты можно так:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Никогда не используйте одинаковые значения для `TELEGRAM_WEBHOOK_SECRET` и `CRON_SECRET`.

## 7. Переменные окружения

| Название | Назначение | Обязательность | Пример без секрета |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Токен BotFather | Да | `1234567890:replace_me` |
| `TELEGRAM_WEBHOOK_SECRET` | Проверка заголовка Telegram | Да; 16–256 символов `A–Z a–z 0–9 _ -` | `replace_with_32_random_chars` |
| `TELEGRAM_ADMIN_IDS` | ID администраторов через запятую | Нет | `123456789,987654321` |
| `RUNWAYML_API_SECRET` | Ключ Runway API | При `USE_MOCK_RUNWAY=false` | `key_replace_me` |
| `DATABASE_URL` | Подключение PostgreSQL | Да | `postgresql://postgres:postgres@localhost:5432/photo_video_bot` |
| `BLOB_READ_WRITE_TOKEN` | Токен Vercel Blob | В production и реальном режиме | `vercel_blob_rw_replace_me` |
| `CRON_SECRET` | Bearer-защита cron | Да, минимум 16 символов | `another_random_secret` |
| `APP_BASE_URL` | Публичный HTTPS URL приложения | Да; локально URL туннеля | `https://project.vercel.app` |
| `DAILY_GENERATION_LIMIT` | Подтверждений на пользователя в сутки UTC | Нет, по умолчанию `5` | `5` |
| `MAX_CONCURRENT_GENERATIONS` | Глобальное число активных задач | Нет, по умолчанию `2` | `2` |
| `GENERATIONS_ENABLED` | Приём новых генераций | Нет, по умолчанию `true` | `true` |
| `USE_MOCK_RUNWAY` | MOCK вместо Runway | Нет, по умолчанию `false`; запрещён при `NODE_ENV=production` | `true` |
| `RATE_LIMIT_REQUESTS` | Запросов пользователя в окне | Нет, по умолчанию `20` | `20` |
| `RATE_LIMIT_WINDOW_SECONDS` | Длительность окна rate limit | Нет, по умолчанию `60` | `60` |
| `MAX_IMAGE_BYTES` | Максимум исходника, не более 16 МБ | Нет, по умолчанию `10485760` | `10485760` |
| `MAX_VIDEO_BYTES` | Максимум видео для Telegram, до 50 МБ | Нет, по умолчанию 49 МиБ | `51380224` |
| `SOURCE_TTL_HOURS` | TTL временного исходника | Нет, по умолчанию `24` | `24` |
| `MAX_SUBMISSION_ATTEMPTS` | Попытки подготовки до вызова Runway | Нет, по умолчанию `3` | `3` |
| `SUBMISSION_STALE_MINUTES` | Таймаут неоднозначного `UPLOADING` | Нет, по умолчанию `15` | `15` |
| `POLL_BATCH_SIZE` | Максимум записей каждого типа за cron | Нет, по умолчанию `20` | `20` |
| `NODE_ENV` | Стандартный режим Node/Next | Устанавливается платформой; в `.env` обычно не нужен | `development` |

Обязательных скрытых переменных нет. Не добавляйте реальные значения в `.env.example`.

## 8. Запуск миграций

Проверьте `DATABASE_URL` в `.env`, затем:

```bash
npm run db:migrate
```

Скрипт применяет файлы из `migrations/` один раз, записывает их в `schema_migrations` и защищает миграции advisory lock. Для production используйте production `DATABASE_URL` только на своём компьютере и не коммитьте `.env`.

## 9. Локальный запуск в MOCK-режиме

В `.env`:

```dotenv
TELEGRAM_BOT_TOKEN=ваш_токен_BotFather
TELEGRAM_WEBHOOK_SECRET=случайный_секрет_из_букв_цифр_и_подчёркиваний
TELEGRAM_ADMIN_IDS=ваш_numeric_Telegram_ID
RUNWAYML_API_SECRET=
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/photo_video_bot
BLOB_READ_WRITE_TOKEN=
CRON_SECRET=другой_случайный_секрет
APP_BASE_URL=http://localhost:3000
USE_MOCK_RUNWAY=true
GENERATIONS_ENABLED=true
```

Запустите:

```bash
npm run db:migrate
npm run dev
```

MOCK сохраняет исходники в `.data/sources`, который исключён из Git. Runway не вызывается, кредиты не расходуются. После poll возвращается `assets/mock.mp4`.

## 10. Локальная проверка Telegram webhook через HTTPS-туннель

В отдельном терминале:

```bash
cloudflared tunnel --url http://localhost:3000
```

Скопируйте выданный `https://…trycloudflare.com` в `APP_BASE_URL`, перезапустите `npm run dev`, затем зарегистрируйте webhook:

```bash
npm run telegram:webhook
npm run telegram:webhook:info
```

В Telegram выполните `/start`, отправьте фото, выберите эффект и подтвердите. Подготовка задачи выполнится после ответа webhook. Для завершения MOCK-цикла вызовите cron два раза:

macOS/Linux:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/process
```

Windows PowerShell:

```powershell
curl.exe -H "Authorization: Bearer $env:CRON_SECRET" http://localhost:3000/api/cron/process
```

Первый вызов обычно переводит MOCK в обработку, второй отправляет MP4. При необходимости вызовите ещё раз: повторы безопасны.

Удалить webhook перед завершением теста:

```bash
npm run telegram:webhook:delete
```

Production polling не реализован намеренно: используется webhook, который не конфликтует с serverless-развёртыванием.

## 11. Подключение реального Runway API

1. Создайте API-ключ в [Runway Developer Portal](https://dev.runwayml.com/) и пополните баланс.
2. Создайте Vercel Blob store и получите токен чтения/записи.
3. Установите:

```dotenv
USE_MOCK_RUNWAY=false
RUNWAYML_API_SECRET=ваш_реальный_ключ
BLOB_READ_WRITE_TOKEN=ваш_реальный_токен_Blob
```

4. Проверьте, что Blob URL доступен Runway: HTTPS, `HEAD`, точные `Content-Type` и `Content-Length`, без редиректа и WAF-блокировки. Токен Telegram наружу не передаётся: Runway получает только случайный URL объекта Blob.
5. Перезапустите приложение.

Модель не подменяется. Если Runway изменит API, SDK поднимет ошибку, задача завершится безопасно, а код необходимо сверить с официальной документацией перед изменением идентификатора или полей.

## 12. Деплой на Vercel

1. Опубликуйте репозиторий по `GITHUB.md`.
2. В Vercel выберите **Add New → Project** и импортируйте репозиторий.
3. Framework определится как Next.js; команды по умолчанию: `npm install`, `next build`.
4. Добавьте все обязательные переменные в **Settings → Environment Variables → Production**:
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ADMIN_IDS`;
   - `RUNWAYML_API_SECRET`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`;
   - `CRON_SECRET`, `APP_BASE_URL`;
   - лимиты и `GENERATIONS_ENABLED=true`, `USE_MOCK_RUNWAY=false`.
5. `APP_BASE_URL` должен быть точным production HTTPS-доменом без `/` в конце.
6. Разверните проект и убедитесь, что build успешен.
7. Примените миграции к production БД со своего компьютера:

```bash
npm run db:migrate
```

8. Зарегистрируйте webhook с production значениями в локальном `.env`:

```bash
npm run telegram:webhook
npm run telegram:webhook:info
```

9. Проверьте `https://ВАШ_ДОМЕН/api/health` и одну ручную генерацию.

Preview deployments используют отдельный `APP_BASE_URL` и отдельный webhook, если они вообще подключаются к Telegram. Не направляйте production webhook одновременно на несколько окружений. Для preview рекомендуется отдельная БД, Blob и отдельный Runway-ключ.

## 13. База данных, Blob и cron

### PostgreSQL

Можно использовать Neon или другой управляемый PostgreSQL. Скопируйте pooled connection string в `DATABASE_URL`. Схема создаётся только через `npm run db:migrate`, а не при каждом запросе.

### Vercel Blob

Создайте Blob store в разделе **Storage**, подключите его к проекту и проверьте `BLOB_READ_WRITE_TOKEN`. Объекты имеют случайные UUID в пути, но доступны по публичному URL до удаления — это необходимо Runway для `HEAD`/`GET`.

### Cron

`vercel.json` содержит:

```json
{
  "crons": [{ "path": "/api/cron/process", "schedule": "* * * * *" }]
}
```

Vercel отправляет `GET` с `Authorization: Bearer <CRON_SECRET>`. Handler проверяет секрет, а не доверяет User-Agent. Cron работает только в production.

На Hobby минутное расписание не поддерживается. Варианты:

- использовать Vercel Pro — основная документируемая конфигурация;
- удалить блок `crons` из `vercel.json` и настроить внешний HTTPS-планировщик на GET каждую минуту с Bearer-заголовком;
- при росте нагрузки вынести `runWorker` в постоянный Railway/Render worker.

Проверка production cron вручную:

```bash
curl -H "Authorization: Bearer ВАШ_CRON_SECRET" https://ВАШ_ДОМЕН/api/cron/process
```

## 14. Регистрация Telegram webhook после деплоя

Локальный `.env` должен содержать production `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` и `APP_BASE_URL`. Затем:

```bash
npm run telegram:webhook
npm run telegram:webhook:info
```

Скрипт вызывает официальный `setWebhook` с `allowed_updates: ["message", "callback_query"]` и секретным заголовком. Он не выводит токен в журнал. Повторная регистрация безопасна и заменяет предыдущий URL.

## 15. Ручная проверка одной реальной генерации

Автоматические тесты используют MOCK и не доказывают наличие доступа, баланса или успешную платную генерацию. Выполните отдельно:

1. Убедитесь, что `USE_MOCK_RUNWAY=false` и webhook указывает на production.
2. Проверьте баланс Runway: для одного 5-секундного видео без входного видео нужно ориентировочно 47 кредитов.
3. Отправьте боту собственную фотографию хорошего качества.
4. Выберите «Естественное движение», проверьте промпт и подтвердите.
5. Дождитесь `/status` со значением `SENT` и MP4 в чате.
6. Проверьте, что видео длится 5 секунд, имеет 720p по меньшей стороне модели и открывается в Telegram.
7. В Runway Developer Portal сверьте фактическую стоимость задачи.
8. Проверьте, что временный исходник удалён из Blob.
9. Отдельно проверьте «Свой запрос» и ошибочный сценарий с отключёнными генерациями, если это нужно перед запуском.

Каждая новая проверка — новая платная генерация.

## 16. Стоимость

По официальному тарифу `kling_4_flash` без входного видео: **9,4 кредита за секунду × 5 секунд = 47 кредитов**. При цене $0,01 за кредит это ориентировочно **$0,47** до налогов и возможных изменений тарифа. Аудио включено. Точная сумма определяется Runway.

Каждая повторная генерация оплачивается отдельно. Не нажимайте подтверждение ради массовых тестов: используйте MOCK. Списание при неудачной задаче зависит от итогового `cost` Runway и его правил возврата; бот не обещает автоматический возврат.

## 17. Troubleshooting

### Telegram не вызывает webhook

- `npm run telegram:webhook:info` должен показывать правильный HTTPS URL.
- URL должен быть публичным, без VPN и HTTP Basic Auth.
- Проверьте `last_error_message` и `pending_update_count` в ответе `getWebhookInfo`.
- После изменения `APP_BASE_URL` повторите `npm run telegram:webhook`.

### Ошибка 401/403

- Для webhook проверьте одинаковый `TELEGRAM_WEBHOOK_SECRET` в Vercel и при регистрации.
- Для cron нужен именно `Authorization: Bearer …`, а не query-параметр.
- 401/403 Runway обычно означает неверный, отозванный или не тот API-ключ.
- `/stats` доступен только numeric ID из `TELEGRAM_ADMIN_IDS`.

### Задача остаётся в PROCESSING

- Проверьте cron и доступность Runway.
- Повторно вызовите защищённый endpoint; lease не создаст параллельный poll.
- Проверьте задачу по `provider_task_id` в Runway Developer Portal.
- Не создавайте повторную платную задачу, пока не выяснен статус исходной.

### Не работает cron

- Проверьте план Vercel: минутное расписание требует Pro.
- Cron выполняется только в production, а не preview.
- Проверьте `CRON_SECRET` в окружении именно production deployment.
- Vercel может пропустить или продублировать вызов; worker рассчитан на оба случая. Ручной вызов восстанавливает очередь.

### Runway не принимает изображение

- Разрешены JPEG, PNG, WebP; GIF не поддерживается.
- Blob должен отвечать на `HEAD` кодом 200 без редиректа.
- `Content-Type` должен быть `image/jpeg`, `image/jpg`, `image/png` или `image/webp`, не `application/octet-stream`.
- URL — HTTPS с доменом, до 2048 символов; исходник по URL — до 16 МБ.
- Разрешите User-Agent с префиксом `RunwayML API/` в WAF.

### Telegram не может получить видео

- Проверьте размер: по умолчанию ограничение 49 МиБ.
- Результат должен быть MP4; provider проверяет сигнатуру `ftyp`.
- Проверьте срок ссылки Runway и повторный cron. После трёх неудачных доставок задача станет `FAILED`.
- Проверьте, что бот не заблокирован пользователем и chat ID не изменился.

### Закончились кредиты

Пополните баланс именно API-проекта Runway, проверьте autobilling и повторите генерацию новой фотографией. Бот не списывает и не возвращает кредиты самостоятельно.

### Ошибки миграции и хранилища

- Проверьте доступность `DATABASE_URL`, SSL и права на `CREATE TABLE`.
- Повторный `npm run db:migrate` пропускает применённые файлы; не редактируйте уже применённую миграцию задним числом.
- Для Blob проверьте `BLOB_READ_WRITE_TOKEN`, подключение store к проекту и права записи/удаления.
- Локальный MOCK требует пустой `BLOB_READ_WRITE_TOKEN`; реальный режим требует настоящий токен.

## 18. Удаление исходников и персональные данные

- Исходники хранятся только под случайным UUID и удаляются после `SENT`/`FAILED` либо по `SOURCE_TTL_HOURS`.
- При временной ошибке удаления cron повторяет попытку.
- В БД остаются технические метаданные задачи и Telegram user/chat ID. Для полного удаления истории пользователя потребуется отдельная процедура удаления записей `users` с каскадом.
- Публичность Blob URL ограничена неугадываемостью пути, а не авторизацией. Не передавайте URL третьим лицам.
- Удаление Blob не удаляет копии, задачи, журналы или резервные копии Runway. Автоматическое удаление задачи у провайдера в MVP не выполняется; настройте retention/удаление в Runway согласно его актуальным правилам.
- Временные output URL Runway истекают; отправленное видео и данные Telegram регулируются политикой Telegram. Бот не может удалить файл с устройства пользователя.
- Не отправляйте чужие фотографии без согласия, документы, биометрические базы или незаконный контент. Для публичного сервиса добавьте модерацию и юридические документы.

## 19. Дальнейшее развитие

- Оплата и подписки через отдельный платёжный модуль; не хранить карточные данные.
- Очередь с гарантированной доставкой и постоянный worker при росте нагрузки.
- Дополнительные модели и длительности только после отдельной проверки их API и тарифов.
- Уведомления администратора о `FAILED` без персональных данных и секретов.
- Модерация изображений и текста, антиспам, квоты по тарифам.
- Команда удаления данных пользователя и регулярная очистка старых технических записей.
- Метрики, alerting, трассировка без содержимого файлов и промптов.

## Проверки проекта

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit
```

Или всё, кроме audit, одной командой:

```bash
npm run check
```

Тесты не требуют PostgreSQL, Telegram, Blob или Runway и используют in-memory реализации. Реальная платная генерация выполняется только вручную по разделу 15.
