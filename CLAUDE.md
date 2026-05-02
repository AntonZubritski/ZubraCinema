# ZubraCinema — контекст для Claude Code

> 📋 Правила ведения доков: `C:\Users\a.zubr\projects-history\RULES.md` (на Mac: `~/projects-history/RULES.md`)

## 🤖 Протокол при старте сессии

Этот файл подгружается автоматически в system prompt — никаких «Контекст: …» от юзера ждать не надо. На первом сообщении юзера выполни:

1. Прочитай `C:\Users\a.zubr\projects-history\RULES.md` (или `~/projects-history/RULES.md` на Mac)
2. Прочитай `C:\Users\a.zubr\projects-history\ZubraCinema\README.md`
3. Прочитай `C:\Users\a.zubr\projects-history\ZubraCinema\current-state.md`
4. Дай краткий summary (≤5 строк): где остановились, что в процессе, открытые баги
5. Жди вопрос. **Не** лезь в `architecture.md` / `decisions.md` / `troubleshooting.md` / `chat-log-summary.md`, пока не понадобятся

## О проекте

Локальное десктоп-приложение (Mac + Windows): парсит торренты фильмов и сериалов, отображает каталог с обложками, по клику запускает воспроизведение через торрент / magnet-ссылки.

- **Repo:** <https://github.com/AntonZubritski/ZubraCinema.git>
- **Local path (Win):** `C:\Users\a.zubr\projects\ZubraCinema\`
- **Доки (Win):** `C:\Users\a.zubr\projects-history\ZubraCinema\`
- **Доки (Mac):** `~/projects-history/ZubraCinema/`

## Стек

- TODO — стек не выбран (обсудить с юзером)
- Источники торрентов: TODO
- Метаданные/обложки: TODO
- Воспроизведение: TODO (mpv + libtorrent / WebTorrent / встроенный плеер)

## Команда запуска Claude Code

```bash
claude --dangerously-skip-permissions --chrome
```

## Обновить доки после сессии

Юзер скажет: «обнови документацию в projects-history/ZubraCinema/». Действия:

1. Перечитать `../RULES.md`
2. Обновить `current-state.md` (и другие MD по необходимости)
3. Если файл перерос лимит из RULES.md — trim по правилам там же
