# Публикация и работа с GitHub

Этот файл описывает публикацию проекта, безопасный первый commit, повседневный рабочий процесс, Releases, Vercel и действия при утечке секрета.

## 1. Проверка перед первым commit

В корне проекта выполните:

```bash
npm ci
npm run check
```

Убедитесь, что:

- `.env` существует только локально и **не попадает** в репозиторий;
- `.env.example`, наоборот, отслеживается Git и содержит только пустые значения или безопасные примеры;
- `node_modules`, `.next`, `.vercel`, `.data`, логи, SQLite-базы и временные файлы исключены;
- в коде нет реальных токенов Telegram, Runway, Blob, секретов webhook/cron и паролей production;
- `git status` не показывает секретных файлов.

До `git init` можно проверить список файлов вручную. После инициализации:

```bash
git status --short
git check-ignore -v .env node_modules .next .data
```

Если `.env` не игнорируется, остановитесь и проверьте `.gitignore`. Файл `.env.example` намеренно является исключением из правила `.env.*`.

Полезная проверка по типичным префиксам (сам по себе поиск не заменяет ревью):

```bash
git grep -n "RUNWAYML_API_SECRET=.*key_" -- . ':!.env.example' || true
```

Не вставляйте реальный секрет в поисковую команду: он останется в истории терминала.

## 2. Создание репозитория через веб-интерфейс GitHub

1. Откройте [github.com/new](https://github.com/new).
2. В **Repository name** укажите, например, `photo-to-video-telegram-bot`.
3. Выберите **Private**, если исходник или архитектура не должны быть публичными. Секреты нельзя хранить даже в приватном репозитории.
4. Не добавляйте README, `.gitignore` и лицензию через форму, чтобы первый push не конфликтовал с локальными файлами.
5. Нажмите **Create repository**.
6. Скопируйте HTTPS URL вида `https://github.com/ВАШ_ЛОГИН/ИМЯ_РЕПОЗИТОРИЯ.git`.

Затем в локальном корне:

```bash
git init
git add .
git status
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/USERNAME/REPOSITORY.git
git push -u origin main
```

`USERNAME` замените на свой логин GitHub, а `REPOSITORY` — на точное имя созданного репозитория. Например, для логина `denis` и репозитория `photo-video-bot`:

```bash
git remote add origin https://github.com/denis/photo-video-bot.git
```

Если `origin` уже создан с ошибкой, исправьте URL, а не добавляйте второй remote с тем же именем:

```bash
git remote set-url origin https://github.com/USERNAME/REPOSITORY.git
```

## 3. Создание репозитория через GitHub CLI

Проверьте установку и авторизацию:

```bash
gh --version
gh auth status
```

При необходимости:

```bash
gh auth login
```

Создайте **приватный** репозиторий и отправьте текущую ветку:

```bash
git init
git add .
git status
git commit -m "Initial commit"
git branch -M main
gh repo create REPOSITORY --private --source=. --remote=origin --push
```

Для публичного репозитория замените `--private` на `--public`. `REPOSITORY` замените на желаемое имя. GitHub CLI подставит ваш аккаунт, создаст remote `origin` и отправит `main`.

Проверка:

```bash
git remote -v
gh repo view --web
```

## 4. Простой рабочий процесс

- `main` — стабильная версия, подключённая к production Vercel.
- Каждое изменение выполняется в отдельной ветке.
- До commit запускаются локальные проверки.
- Commit должен описывать одно понятное изменение.
- Ветка отправляется на GitHub, затем создаётся Pull Request.
- После проверки preview и ревью ветка сливается в `main`.

Пример улучшения промптов:

```bash
git checkout main
git pull
git checkout -b feature/improve-prompts
```

После изменений:

```bash
npm run check
git status
git add .
git commit -m "Improve photo animation prompts"
git push -u origin feature/improve-prompts
```

Создайте Pull Request:

```bash
gh pr create --fill
```

Либо откройте ссылку GitHub, которая появится после push. После ревью и слияния:

```bash
git checkout main
git pull
```

Удалить локальную ветку после слияния:

```bash
git branch -d feature/improve-prompts
```

## 5. Обновление локального проекта

Сначала убедитесь, что изменения сохранены в commit или отложены осознанно:

```bash
git status
git checkout main
git pull
```

Если есть незакоммиченная работа, не удаляйте её ради `git pull`. Создайте отдельную ветку и commit либо используйте `git stash`, понимая, как затем восстановить изменения:

```bash
git stash push -m "work in progress"
git pull
git stash pop
```

После обновления зависимостей:

```bash
npm ci
npm run check
```

Если добавилась миграция:

```bash
npm run db:migrate
```

## 6. История изменений

Локально:

```bash
git log --oneline --decorate --graph -20
```

Подробнее по конкретному commit:

```bash
git show COMMIT_HASH
```

На GitHub откройте **Commits** на странице репозитория. Pull Request показывает обсуждение, проверки и diff; blame помогает понять происхождение конкретной строки.

## 7. Теги и Releases

После проверенного слияния в `main`:

```bash
git checkout main
git pull
npm run check
git tag -a v1.0.0 -m "Production-ready MVP"
git push origin v1.0.0
```

Создание Release через CLI:

```bash
gh release create v1.0.0 --title "v1.0.0 — Production-ready MVP" --notes "Telegram photo-to-video bot with Runway, PostgreSQL and Vercel Cron."
```

Через веб-интерфейс: **Releases → Draft a new release**, выберите тег, укажите название и изменения. Используйте семантическое версионирование: исправление — `v1.0.1`, обратно совместимая функция — `v1.1.0`, несовместимое изменение — `v2.0.0`.

## 8. Отмена ошибочного commit

В общей ветке используйте `git revert`: он создаёт новый commit, отменяющий изменения, и не переписывает опубликованную историю.

```bash
git log --oneline -10
git revert COMMIT_HASH
npm run check
git push
```

Если commit уже вызвал production-инцидент, дополнительно откатите deployment в Vercel. `revert` меняет исходник, но сам по себе не гарантирует мгновенный откат данных или внешних интеграций.

Не используйте `git reset --hard` и `git push --force` в общей ветке: это может удалить чужую работу, нарушить локальные копии команды и скрыть историю инцидента. Для личной неопубликованной ветки любые операции всё равно сначала проверяйте через `git status` и резервную ветку.

## 9. Автоматический деплой Vercel из main

1. Импортируйте GitHub-репозиторий в Vercel.
2. В **Project Settings → Git** убедитесь, что production branch — `main`.
3. Установите production environment variables по `README.md`.
4. Каждое слияние в `main` запускает production build и deployment.
5. Не коммитьте `.env`; секреты настраиваются только в Vercel.

Preview deployments создаются для веток и Pull Request. Они позволяют проверить build и маршруты до слияния. Для Telegram preview требуется отдельный бот/webhook и отдельные БД/Blob; без них ограничьтесь build и тестами, не переключая production webhook.

## 10. Откат deployment в Vercel

1. Откройте проект → **Deployments**.
2. Найдите последний известный рабочий production deployment.
3. В меню deployment выберите **Promote** или **Rollback** (название зависит от интерфейса Vercel).
4. Проверьте `/api/health`, webhook и одну безопасную тестовую операцию.
5. После отката исправьте причину через Pull Request. Не оставляйте `main` и production рассинхронизированными надолго.

Откат кода не откатывает миграции PostgreSQL. Обратимость миграций нужно проектировать отдельно и делать резервные копии.

## 11. Случайная публикация секрета

Действуйте немедленно:

1. **Отзовите и перевыпустите** скомпрометированный ключ у провайдера: Telegram BotFather, Runway, Vercel Blob, база данных или иной сервис.
2. Обновите секреты в Vercel и локальном `.env`, переразверните production.
3. Для Telegram webhook и cron задайте новые независимые секреты и повторно зарегистрируйте webhook.
4. Удалите секрет из текущих файлов отдельным commit, но не считайте это достаточным: старая история и копии GitHub могут сохранить значение.
5. Проверьте журналы использования на неавторизованную активность и возможные расходы.
6. Сообщите команде и при необходимости затронутым пользователям.

После ротации можно очистить историю специализированным инструментом, например `git filter-repo`, согласовав это со всеми участниками. Очистка истории не заменяет отзыв ключа и требует координации force push. Самый безопасный путь — не допускать секрет в commit через `.gitignore`, ревью `git status` и secret scanning.

## 12. Рекомендуемые настройки GitHub

- Защитите `main`: Pull Request, успешные проверки, запрет force push.
- Включите **Secret scanning** и **Push protection**.
- Настройте GitHub Actions для `npm ci` и `npm run check`.
- Требуйте успешный Vercel preview перед слиянием.
- Ограничьте права токенов и используйте отдельные ключи для development, preview и production.
