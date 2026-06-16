---
# Markdown-versio ../latex/esimerkki-kayttoohje.tex-asiakirjasta:
# käyttöohje, jossa on kuvatekstillisiä kuvia tekstin tasossa (6.5.2),
# numeroituja vaiheluetteloita sisäkkäisine luetteloineen (6.5.3),
# tehtävälista (- [ ] / - [x]) sekä korostuksia (**lihava**, *kursiivi*,
# `koodi`). Vaihtoehto "font: sans-serif" latoo asiakirjan groteskilla,
# joka vastaa standardin omien esimerkkien ulkoasua.
doctype: Käyttöohje
date: 20.5.2024
author: Virve Virtanen
subject: Graafinen ohjeisto
title: Logon käyttö asiakirjoissa
logo: ../logo-organisaatio.pdf
font: sans-serif
contact:
  name: Organisaatio Oy
  lines:
    - Katuosoite
    - Postinumero Postitoimipaikka
    - viestinta@organisaatio.fi
forinformation:
  - Viestintäosasto
features: [no-endmatter-newpage]
---

# Logon perusversio

Logon perusversiota käytetään **kaikissa** organisaation asiakirjoissa.
Logo sijoitetaan asiakirjan vasempaan yläkulmaan, ja *sähköisessä*
asiakirjassa sille annetaan vaihtoehtoinen teksti, esimerkiksi
"Organisaatio Oy:n logo". Perusversion tiedostonimi on
`logo-organisaatio.pdf`.

![Logon perusversio](../logo-organisaatio.pdf)

# Suoja-alue

Logon ympärille jätetään aina vapaata tilaa vähintään logon
merkkiosan korkeuden (x) verran. Suoja-alueelle ei sijoiteta
tekstiä eikä muita graafisia elementtejä.

![Logon suoja-alue, jonka leveys on merkkiosan korkeus x](../logo-suoja-alue.pdf)

# Logon lisääminen asiakirjaan

Logo lisätään asiakirjamalliin seuraavasti:

1. Avaa asiakirjamalli ja siirry asiakirjan alkuun.
2. Lisää logotiedosto asiakirjan vasempaan yläkulmaan. Käytä
   tarkoitukseen sopivaa tiedostomuotoa:
    - painotuotteissa `.pdf` tai `.eps`
    - verkkojulkaisuissa `.png`
3. Kirjoita logolle vaihtoehtoinen teksti.
4. Tarkista, että perusmetatietojen alue ei mene logon päälle.

Jos logon koko tai sijoittelu sitä vaatii, perus- ja lisämetatietojen
alueita voi siirtää alemmas tai enemmän oikealle.

# Tarkistuslista ennen julkaisua

- [x] Logo on asiakirjan vasemmassa yläkulmassa.
- [x] Logolla on vaihtoehtoinen teksti.
- [ ] Suoja-alue on tarkistettu.
