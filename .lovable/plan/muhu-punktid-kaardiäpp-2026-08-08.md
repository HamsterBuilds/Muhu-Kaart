# Muhu punktid — kaardiäpp

Telefonis kasutatav äpp, mis näitab ainult Muhu saare kaarti, jälgib sinu liikumist ja laseb sõpradega jagada lemmikkohti.

## Mida ehitame

**1. Kaart ainult Muhust**
- Kaart on lukustatud Muhu saare piiridesse (ei saa mujale kerida ega liiga kaugele suumida).
- Suur, sõrmega mugav kasutus telefonis.

**2. "Jälgi mind" nupp**
- Nupp töötab ainult siis, kui su asukoht on Muhu saarel. Mujal on nupp passiivne ja näitab teadet "Sa ei ole Muhu saarel".
- Vajutades hakkab äpp asukohta pidevalt salvestama; teine vajutus lõpetab.
- Sinu rada joonistatakse kaardile — **ainult sinule endale**. Sõbrad radu ei näe.

**3. Punkti lisamine**
- Nupp "Lisa punkt" paneb praegusesse asukohta punkti.
- Sina kirjutad ainult pealkirja.
- Seejärel otsib AI netist selle koha kohta infot ja lisab automaatselt kuni 2-lauselise kirjelduse ning pildi.
- Kui AI midagi ei leia, jääb ainult pealkiri (saad kirjelduse ise üle kirjutada).

**4. Grupid ja jagamine**
- Loo grupp → saad 6-kohalise koodi, mille jagad sõpradele.
- Sõber sisestab koodi ja liitub. Grupis näevad kõik üksteise punkte (nimi + pealkiri + AI kirjeldus + pilt), aga mitte üksteise radu.
- Saad kuuluda mitmesse gruppi ja gruppide vahel vahetada.

**5. Sisselogimine ilma paroolita**
- Esmakordsel avamisel valid endale nime ja saad isikliku 6-kohalise koodi.
- Kood jääb telefoni mällu, nii et järgmisel korral logib ise sisse.
- Teises telefonis saad sama koodi sisestada, et oma kontole ligi pääseda.

**6. APK / telefoni paigaldamine**
- Ehitame veebiäpi, mille saab telefonis kohe kasutada ja avaekraanile paigaldada.
- APK jaoks lisan Capacitori seadistuse (Android GPS-load kaasa arvatud). Päris APK-faili ehitamine käib sinu arvutis Android Studioga — annan täpsed käsud juurde. Taustal jälgimine töötab APK-s paremini kui brauseris.

## Tehniline osa

- Kaart: Leaflet + OpenStreetMap, `maxBounds` Muhu bbox-ile (~58.51–58.72 N, 22.90–23.35 E), Muhu piirjoon polügoonina; punkt-Muhus kontroll toimub selle polügooni sees.
- Asukoht: `navigator.geolocation.watchPosition` (high accuracy), rajapunktid puhverdatakse ja saadetakse partiidena.
- Backend: Lovable Cloud. Tabelid: `users` (nimi, 6-kohaline kood, hash), `groups` (nimi, liitumiskood), `group_members`, `points` (grupp, autor, koordinaadid, pealkiri, AI kirjeldus, pildi URL), `tracks` + `track_points` (ainult omanikule).
- Kuna klassikalist sisselogimist ei kasuta, on tabelitel RLS kinni ja kogu ligipääs käib `createServerFn` kaudu, mis kontrollib koodi serveripoolel. Rajad on päritavad ainult omaniku koodiga.
- AI rikastamine: Lovable AI (veebiotsing + 2-lauseline kirjeldus), pilt salvestatakse Cloud Storage'isse; töötab taustal peale punkti loomist.
- Capacitor: `@capacitor/geolocation`, Android manifestis `ACCESS_FINE_LOCATION` + foreground service jälgimiseks.

## Mida tasub teada

- 6-kohaline kood on lihtne ja mugav, aga vähem turvaline kui parool — kui keegi koodi teab, pääseb ta su kontole. Genereerime koodid juhuslikult ja piirame sisestuskatseid.
- Taustal jälgimine brauseris peatub, kui telefoni ekraan kustub; APK-s see probleem kaob.
