# JamMap — с чего начать (для maga)

Дедлайн хакатона Colosseum **Crypto World's Fair**: **13 октября 2026, 06:59 UTC = 11:59 по Шымкенту**.
Подавай **12 октября вечером**, не в последний час.

## Что уже готово
- **Программа на Solana** (`programs/jammap`): регистрация телефонов, проверка подписи телефона, консенсус «3 разных телефона = подтверждённый инцидент», награды из хранилища.
- **Сервер** (`server/`): принимает отчёты, проверяет подписи и цифры, отправляет в Solana, продаёт данные через x402.
- **Симулятор** (`server/src/sim.js`): 17 виртуальных телефонов, глушилка, подмена сигнала, телефон в металлической коробке и мошенник.
- **Карта** (`web/`): живая панель.
- **Android-приложение** (`android/`).
- **Тесты**: детектор (Node), программа (Anchor).

## Шаг 1. Запустить демо на компьютере (сегодня, 5 минут)
Открой терминал в приложении Claude (или PowerShell) и выполни по очереди:

```
cd C:\Users\mef\Desktop\solana\jammap\server
npm.cmd install
npm.cmd run demo
```
Открой http://localhost:8787. Во **втором** терминале:
```
cd C:\Users\mef\Desktop\solana\jammap\server
npm.cmd run sim
```
Через ~30 секунд на карте появится красная зона: глушилку подтвердили телефоны. Нажми на инцидент, чтобы увидеть график доказательств. Во вкладке **Route check** поставь две точки на карте и проверь маршрут, это платный запрос через x402.

## Шаг 2. Инструменты Solana (3 октября)
Anchor на Windows лучше всего работает через **WSL** (Linux внутри Windows).
1. PowerShell **от администратора**: `wsl --install`, перезагрузка, задай имя и пароль Ubuntu.
2. В Ubuntu одна команда ставит Rust, Solana CLI, Anchor и Node:
   ```
   curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
   ```
3. Перейди в проект: `cd /mnt/c/Users/mef/Desktop/solana/jammap`
4. `anchor build`, затем `anchor keys sync`, затем снова `anchor build`.
5. `npm install`, затем `anchor test`. Тесты должны пройти. Если будут ошибки, скинь их мне, я поправлю.

## Шаг 3. Devnet (4 октября)
```
solana config set --url devnet
solana-keygen new            # если ещё нет кошелька
solana airdrop 2             # или https://faucet.solana.com
anchor deploy --provider.cluster devnet
cd server
JAMMAP_PROGRAM_ID=<ID из deploy> node scripts/setup-devnet.js
```
Создай файл `server/.env`:
```
JAMMAP_PROGRAM_ID=<ID>
RELAYER_KEYPAIR=.keys/relayer.json
```
Теперь `npm run demo` + `npm run sim` пишут каждый отчёт в Solana, и на карте появляются ссылки на транзакции.
Для настоящей оплаты x402: возьми devnet USDC на https://faucet.circle.com (сеть Solana Devnet) на адрес покупателя из вывода `setup-devnet`, затем `npm run buy`.

## Шаг 4. Телефон (5 октября)
1. Установи Android Studio: https://developer.android.com/studio
2. Open → папка `jammap/android`. Студия сама скачает Gradle (это долго, норма).
3. На телефоне включи «Режим разработчика» и «Отладку по USB», подключи кабель, нажми ▶ Run.
4. В приложении укажи адрес сервера `http://<IP твоего ноутбука>:8787` (узнать IP: `ipconfig`) и свой Solana-кошелёк, затем **Register** и **Start listening**.
5. Выйди на улицу. Если в строке AGC написано «not exposed», этот телефон не годится для отчётов, нужен другой (Pixel 5+, Galaxy S21+ и новее).
6. Галочка **Test mode** подмешивает к настоящему сигналу искусственное глушение. Так на демо видно весь путь «телефон → Solana → карта» **без всякого передатчика**.

⚠️ Никогда не покупай и не включай глушилки. Это уголовно наказуемо. JamMap только слушает.

## Шаг 5. Проверка спроса (6–8 октября, самое важное для судей)
Смотри `docs/GTM-AND-VALIDATION.md`: там кому писать, что спрашивать и как фиксировать ответы.

## Шаг 6. Видео и подача (9–12 октября)
- `docs/DEMO-VIDEO-SCRIPT.md` — демо-видео (≤ 3 мин).
- `docs/PITCH-VIDEO-SCRIPT.md` — питч (2–3 мин). **Перескажи своими словами.**
- `docs/SUBMISSION-CHECKLIST.md` — что спросит форма Colosseum.
- Создай репозиторий на GitHub и залей туда папку `jammap`. Делай коммиты каждый день: судьи смотрят, что работа шла во время хакатона.
