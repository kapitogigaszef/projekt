# Fragline CS2 Stats

## Uruchomienie

Wymagany jest Node.js 20 lub nowszy. Projekt nie ma zewnętrznych zależności.

```sh
node server.mjs
```

Otwórz `http://localhost:8000`. Jeśli port jest zajęty, uruchom serwer z innym portem, na przykład `PORT=8001 node server.mjs`.

## Konto administratora

Przy pierwszym uruchomieniu wybierz „Zaloguj admina” i utwórz konto. Login ma 3–24 znaki, a hasło co najmniej 6 znaków. Konto można skonfigurować tylko raz. Hasło jest przechowywane jako hash `scrypt`, a sesja używa ciasteczka HttpOnly.

Zalogowany administrator może dodawać i usuwać zawodników oraz mecze. Zawodnik w katalogu ma tylko nick; nie przypisuje się mu roli ani drużyny. Przy dodawaniu meczu podaje się własne nazwy obu drużyn, wybiera pięciu zawodników na stronę i wpisuje ich statystyki. Dane są zapisywane w `.runtime/league.json` i pozostają po restarcie serwera.

## JSONBin

Domyślny BIN ID: `6ac3d214ffd5d160534fd41a`. Wpisz prawdziwy klucz JSONBin w lokalnym pliku `.env` (pole `JSONBIN_MASTER_KEY=`); ten plik jest ignorowany przez Git. Opcjonalnie BIN ID można nadpisać przez `JSONBIN_BIN_ID`. Serwer pobiera stan binu metodą GET przy starcie i zapisuje zmiany admina metodą PUT. Klucz jest wysyłany wyłącznie z backendu w nagłówku `X-Master-Key`; nie umieszczaj go w HTML ani repozytorium. Bez klucza serwer pozostaje w lokalnym trybie `.runtime/league.json`.

To lokalny panel demonstracyjny. Przed udostępnieniem publicznie uruchom go za HTTPS i dodaj kopie zapasowe pliku danych.