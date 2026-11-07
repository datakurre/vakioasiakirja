// Document templates registry for SFS 2487 web editor.
// Includes standard Finnish office templates: minutes, meeting notices,
// quotations, reports, memos, and a blank starting template.

export interface DocumentTemplate {
  id: string;
  title: string;
  description: string;
  doctype: string;
  defaultFileName: string;
  content: string;
  logoSvg?: string;
}

export const TEMPLATE_POYTAKIRJA = `---
doctype: Pöytäkirja
date: 15.5.2024
author: Virve Virtanen
confidentiality: Luottamuksellinen
subject: Digiprojekti
title: Asiakaspalautteet ja etusivun uudistaminen
features: [endmatter-newpage]
contact:
  name: Organisaatio Oy
  lines:
    - Katuosoite
    - Postinumero Postitoimipaikka
    - Puhelinnumero
    - www-osoite
    - Y-tunnus
attachments:
  - Yhteenveto asiakaspalautteesta
  - Ehdotus etusivulle tehtävistä muutoksista
distribution:
  - Digiprojektin ohjausryhmä
forinformation:
  - Johtoryhmä
---

Aika ja paikka
:   13.5.2024 klo 12.30--13.45\\
    Verkkokokous

Osallistujat
:   Marja Mäkinen, puheenjohtaja\\
    Niilo Nieminen\\
    Lasse Lahtinen\\
    Virve Virtanen, sihteeri

# Kokouksen avaus

Puheenjohtaja avasi kokouksen ja toivotti kaikki tervetulleiksi.

# Asiakaspalautteen läpikäynti ja tehtävät muutokset

Käytiin läpi yhteenveto asiakaspalautteesta (liite 1). Päätettiin, että
tuotehinnasto päivitetään kaksi kertaa kuukaudessa.

# Etusivun uudistaminen

Hyväksyttiin viestintäosaston sihteerin ehdotus (liite 2) tehtävistä
muutoksista sillä lisäyksellä, että yhteystiedot näkyvät heti etusivulla.
Päätettiin, että puheenjohtaja esittelee tehtävät muutokset johdolle.

# Seuraavat kokoukset

- 20.5.2024 toimituksen kokoustilassa
- 27.5.2024 verkossa
`;

export const TEMPLATE_KOKOUSKUTSU = `---
doctype: Kokouskutsu
date: 6.5.2024
author: Virve Virtanen
subject: Digiprojekti
title: Projektiryhmän kokous 5/2024
features: [agenda, no-endmatter-newpage]
contact:
  name: Organisaatio Oy
  lines:
    - Katuosoite
    - Postinumero Postitoimipaikka
    - Puhelinnumero
    - www-osoite
attachments:
  - Yhteenveto asiakaspalautteesta
distribution:
  - Projektiryhmän jäsenet
forinformation:
  - Johtoryhmä
---

Projektiryhmän seuraava kokous pidetään maanantaina 13.5.2024
klo 12.30--13.45 verkkokokouksena. Kokouslinkki lähetetään
osallistujille kalenterikutsussa.

# Esityslista {-}

# Kokouksen avaus

# Asiakaspalautteen läpikäynti ja tehtävät muutokset

Yhteenveto asiakaspalautteesta on kutsun liitteenä.

# Etusivun uudistaminen

Käsitellään viestintäosaston sihteerin ehdotus etusivulle
tehtävistä muutoksista.

# Seuraavat kokoukset
`;

export const TEMPLATE_TARJOUS = `---
doctype: Tarjous
date: 15.5.2024
author: Matti Meikäläinen
docid: Tarjousnumero 12345
confidentiality: Luottamuksellinen
extrametadata:
  - Sähköiset palvelut / Matti Meikäläinen
  - Hankenumero 123456/2023
  - Asiakasnumero 987654
recipient:
  - Oy Yritys Ab
  - Essi Esimerkki
  - Esimerkkitie 1
  - 12345 Esimerkkipaikkakunta
subject: Digiprojekti
title: Verkkosivujen uudistaminen
contact:
  name: Oy Firma Ab
  lines:
    - Esimerkkikatu 1
    - 12345 Esimerkkipaikkakunta
    - p. 09 1234 567
    - www.esimerkkiosoite.fi
    - "Y-tunnus: 1234567-1"
---

Kiitämme tarjouspyynnöstänne 2.5.2024 ja tarjoamme verkkosivujenne
uudistamista seuraavasti.

Toimitus sisältää verkkosivuston ulkoasun uudistamisen,
sisällönhallintajärjestelmän päivityksen sekä saavutettavuusarvioinnin
korjausehdotuksineen. Työ tehdään touko--elokuussa 2024, ja sen
kokonaishinta on 12 000 euroa (alv 0 %).

Tarjous on voimassa 30.6.2024 saakka.

Ystävällisin terveisin

Oy Firma Ab

::: handsignature
Matti Meikäläinen, titteli
:::
`;

export const TEMPLATE_RAPORTTI = `---
doctype: Toimintakertomus
date: 15.5.2024
author:
  - Virve Virtanen
  - Matti Meikäläinen
subject: Vuosiraportti
title: Toimintakertomus 2025
features: [endmatter-newpage]
contact:
  name: Organisaatio Oy
  lines:
    - Katuosoite 1
    - 00100 Helsinki
    - info@organisaatio.fi
---

# 1. Johdanto

Vuosi 2025 oli organisaatiolle merkittävän kehityksen aikaa. Tässä toimintakertomuksessa
luodaan katsaus keskeisiin hankkeisiin ja saavutettuihin tuloksiin.

# 2. Toiminta ja hankkeet

## 2.1 Digitaaliset palvelut

Digitaalisten palveluiden uudistus saatiin päätökseen suunnitellussa aikataulussa.
Palveluiden käyttäjämäärät kasvoivat 25 prosenttia edellisvuoteen verrattuna.

## 2.2 Koulutus ja sidosryhmätyö

Järjestimme vuoden aikana kymmenen asiantuntijatapahtumaa ja verkkoseminaaria.

# 3. Yhteenveto ja tulevaisuus

Tulevan vuoden painopisteenä on palveluiden saavutettavuuden ja laadun jatkuva parantaminen.
`;

export const TEMPLATE_MUISTIO = `---
doctype: Muistio
date: 15.5.2024
author: Virve Virtanen
subject: Sisäinen tiedote
title: Toimitilauudistuksen aikataulu ja ohjeet
contact:
  name: Organisaatio Oy
  lines:
    - Katuosoite 1
    - 00100 Helsinki
---

# 1. Tausta ja tavoite

Toimistomme tiloja uudistetaan ergonomian ja yhteistyötilojen parantamiseksi.
Muutostyöt alkavat kesäkuussa.

# 2. Aikataulu

- 1.6. Valmistelut ja tavaroiden pakkaus
- 15.6.--30.6. Pintaremontti ja kalusteasennukset
- 1.7. Uusien tilojen käyttöönotto

# 3. Toimintaohjeet henkilöstölle

Kaikkia pyydetään siivoamaan työpisteensä ennen toukokuun loppua.
`;

export const TEMPLATE_TYHJA = `---
doctype: Asiakirja
title: Asiakirjan otsikko
date: 7.11.2026
author: Etunimi Sukunimi
subject: Aihe
contact:
  name: Organisaatio Oy
  lines:
    - Katuosoite 1
    - 00100 Helsinki
    - info@organisaatio.fi
---

# 1. Johdanto

Asiakirjan sisältö alkaa tästä. Teksti noudattaa automaattisesti SFS 2487:2024 -standardin asettelu- ja sarkainsääntöjä.

# 2. Toinen luku

Tähän voit kirjoittaa seuraavan luvun sisällön.
`;

export const BUILTIN_TEMPLATES: DocumentTemplate[] = [
  {
    id: "poytakirja",
    title: "Kokouspöytäkirja",
    description: "SFS 2487:2024 Liite A: virallinen pöytäkirja läsnäolijoineen ja päätöksineen.",
    doctype: "PÖYTÄKIRJA",
    defaultFileName: "poytakirja.md",
    content: TEMPLATE_POYTAKIRJA.trim(),
  },
  {
    id: "kokouskutsu",
    title: "Kokouskutsu ja esityslista",
    description: "Kokouskutsu ja loppupisteellinen esityslista (features: [agenda]).",
    doctype: "KOKOUSKUTSU",
    defaultFileName: "kokouskutsu.md",
    content: TEMPLATE_KOKOUSKUTSU.trim(),
  },
  {
    id: "tarjous",
    title: "Tarjousasiakirja",
    description: "SFS 2487:2024 Liite B: virallinen tarjous vastaanottaja- ja allekirjoitusalueilla.",
    doctype: "TARJOUS",
    defaultFileName: "tarjous.md",
    content: TEMPLATE_TARJOUS.trim(),
  },
  {
    id: "raportti",
    title: "Toimintakertomus / raportti",
    description: "Monisivuinen raportti väliotsikoilla ja kappalejaolla.",
    doctype: "TOIMINTAKERTOMUS",
    defaultFileName: "toimintakertomus.md",
    content: TEMPLATE_RAPORTTI.trim(),
  },
  {
    id: "muistio",
    title: "Muistio",
    description: "Ytimekäs sisäinen muistio tai tiedote.",
    doctype: "MUISTIO",
    defaultFileName: "muistio.md",
    content: TEMPLATE_MUISTIO.trim(),
  },
  {
    id: "tyhja",
    title: "Perusasiakirja (tyhjä)",
    description: "Puhdas peruspohja omalle SFS 2487 -asiakirjalle.",
    doctype: "ASIAKIRJA",
    defaultFileName: "asiakirja.md",
    content: TEMPLATE_TYHJA.trim(),
  },
];

/**
 * Returns available document templates, merging custom templates if configured.
 */
export function getDocumentTemplates(): DocumentTemplate[] {
  if (typeof window !== "undefined" && (window as any).__ASSOCIATION_TEMPLATES__) {
    const custom = (window as any).__ASSOCIATION_TEMPLATES__ as DocumentTemplate[];
    if (Array.isArray(custom) && custom.length > 0) {
      return custom;
    }
  }
  return BUILTIN_TEMPLATES;
}

export function getTemplateById(id: string): DocumentTemplate | undefined {
  return getDocumentTemplates().find((t) => t.id === id);
}
