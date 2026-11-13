# Разработка и поддержка бота

## Production

- Next.js: `https://22-08-59-afecda10.vercel.app`
- Видеопровайдер: официальный Kling API, `VIDEO_PROVIDER=kling`.
- База данных: Neon PostgreSQL.
- Исходные фотографии: Vercel Blob.
- Telegram webhook: `APP_BASE_URL/api/telegram/webhook`.
- Обработчик задач: `APP_BASE_URL/api/cron/process`.
- Внешний планировщик cron-job.org вызывает обработчик каждую минуту с Bearer `CRON_SECRET`.

## Безопасная локальная разработка

1. Установите Node.js 20.9 или новее и выполните `npm install`.
2. Скопируйте `.env.example` в `.env` и заполните локальные значения.
3. Используйте отдельную тестовую базу Neon, а не production БД.
4. Для безопасной разработки установите:

```dotenv
USE_MOCK_RUNWAY=true
GENERATIONS_ENABLED=false
```

5. Запустите `npm run dev`.

Не запускайте локальный обработчик против production БД: он может изменять общие задачи. Платную генерацию разрешайте только отдельно и вручную.

## Основные команды

```powershell
npm run dev                 # локальный сервер
npm run check               # lint, typecheck, тесты и production build
npm run lint
npm run typecheck
npm test
npm run db:migrate          # миграции в базу из локального DATABASE_URL
npm run telegram:webhook    # регистрация webhook по APP_BASE_URL
npm run telegram:webhook:info
```

## Обычная доработка

1. Внести изменение и обновить тесты.
2. Проверить `git status` и `git diff`, убедиться, что секреты не добавлены.
3. Выполнить `npm run check`.
4. Добавить только нужные файлы через `git add`.
5. Сделать коммит с понятным описанием.
6. Отправить изменения в GitHub через `git push`.
7. Дождаться автоматического deployment Vercel и проверить production.

Для крупных изменений создавайте отдельную ветку, например `feature/new-effects`, и объединяйте её после проверки.

## Переменные окружения

Секреты не коммитятся. Они хранятся локально в `.env` и в Vercel → Project → Settings → Environment Variables → Production.

После изменения production-переменной нужен новый deployment. При смене production-домена обновите `APP_BASE_URL` и повторно зарегистрируйте Telegram webhook.

## Миграции и данные

Перед изменением схемы создайте новую миграцию в `migrations/`, проверьте её на тестовой базе и только затем применяйте к production. Не меняйте уже применённые миграции задним числом. Откат кода не откатывает данные или схему БД.

## Откат

Для отмены коммита используйте `git revert <commit>` и отправьте новый коммит в GitHub. Vercel опубликует исправление автоматически. Для аварийного отката можно выбрать предыдущий успешный deployment в Vercel.

Стабильные версии отмечайте тегами `v1.0.0`, `v1.1.0` и так далее.

## Регулярный контроль

- Vercel deployment и Function Logs.
- История запусков cron-job.org: ожидается HTTP 200.
- `pending_update_count` и ошибки в `npm run telegram:webhook:info`.
- Количество задач `FAILED` и поле `safe_error` в БД.
- Баланс Kling и дневной лимит генераций.
- Состояние Neon и Vercel Blob.

Не повторяйте `provider.create()` после неизвестного сбоя сети: это может создать вторую платную задачу. Опрос выполняется только по сохранённому `provider_task_id`.
