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

To lokalny panel demonstracyjny. Przed udostępnieniem publicznie uruchom go za HTTPS i dodaj kopie zapasowe pliku danych.