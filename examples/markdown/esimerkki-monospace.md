---
# Markdown-versio ../latex/esimerkki-monospace.tex-asiakirjasta:
# muistio tasavälisellä kirjasinlajilla (Courier). Vaihtoehto
# "font: monospace" latoo asiakirjan kirjoituskonetyylisesti. Mukana
# sisäkkäinen luettelo, tasavälinen koodimerkintä (`koodi`) ja koodilohko.
doctype: Muistio
date: 5.6.2024
author: Tero Testi
subject: Tietojärjestelmä
title: Käyttöoikeuksien hallinta
logo: ../logo-organisaatio.pdf
font: monospace
contact:
  name: Organisaatio Oy
  lines:
    - Katuosoite
    - Postinumero Postitoimipaikka
    - it@organisaatio.fi
forinformation:
  - Johtoryhmä
features: [no-endmatter-newpage]
---

Vastaanottajat
:   Järjestelmänvalvojat

# Nykytilanne

Käyttöoikeuksia hallitaan tällä hetkellä manuaalisesti jokaisen
järjestelmän omassa hallintarajapinnassa. Tunnuksia luodaan
pyydettäessä sähköpostilla, eikä vanhentuneita tunnuksia poisteta
järjestelmällisesti.

# Ehdotus

Otetaan käyttöön keskitetty identiteetinhallintajärjestelmä, joka
tukee `SCIM`- ja `LDAP`-rajapintoja. Se yhdistää kaikki
organisaation järjestelmät yhteen hallintapisteeseen ja mahdollistaa
automaattisen tunnusten elinkaarihallinnan.

1. Valitaan järjestelmä ja kilpailutetaan toimittajat.
2. Toteutetaan pilotti kahdelle järjestelmälle:
    - sähköpostijärjestelmä
    - asianhallintajärjestelmä
3. Laajennetaan käyttöönotto koko organisaatioon.

Tunnusten synkronointi ajastetaan komennolla:

```
idm sync --scope all --remove-stale
```
