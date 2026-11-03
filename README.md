# fotolink
Fotolink to prywatny, mobilny odpowiednik imgur na Firebase (plan Spark, 0 zł). Wrzucam zdjęcie z telefonu w oryginalnej jakości i dostaję unikalny link z terminem ważności. Plik jest dzielony na części po 1 MB w Firestore i sklejany z kontrolą SHA-256. Przed wysłaniem usuwana jest lokalizacja GPS, a wysyłać mogę tylko ja.
