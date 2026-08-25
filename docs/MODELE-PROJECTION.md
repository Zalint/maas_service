# Le modèle de projection de fin de mois

Ce document décrit ce que calcule l'onglet **Finance → Simulation 2.0 → Projection
fin de mois**, sur quelles hypothèses, et où chaque règle vit dans le code.

Il est écrit pour deux lecteurs : le propriétaire du produit qui doit décider si
une hypothèse lui convient, et le développeur qui doit modifier une règle sans en
casser une autre.

---

## 1. Où vit le calcul

| Fichier | Rôle |
|---|---|
| `js/simulation-v2-projection.js` | **Module pur**, sans DOM ni réseau. Toutes les règles de projection. Testé par `tests/simulation-v2-projection.test.js`. |
| `js/simulation-v2-moteur.js` | Le moteur d'effets (marges, parage, commission induite). Testé séparément. |
| `js/simulation-v2.js` | L'écran. **Ne calcule rien** : il branche le module et met en forme. |

**Règle d'architecture** : aucune formule de projection ne doit être écrite dans
l'écran. Une règle écrite dans le rendu est intestable — aucun test du dépôt
n'instancie le DOM — et devient une seconde source de vérité qui diverge.

Cette règle a déjà été enfreinte une fois (le calcul du Δ équilibre), puis
corrigée en déplaçant le calcul dans `volumesProjetes()`.

---

## 2. La saisonnalité : P1 et P2

Le mois est coupé en deux régimes de vente :

- **P1** — jours **1 à 10** et **25 à fin de mois** (lendemains et veilles de paie)
- **P2** — jours **11 à 24**

Un **coefficient** dit combien une journée P1 vend de plus qu'une journée P2.

Valeurs de référence du document source :

| Point de vente | Coefficient |
|---|---|
| O. Foire | 1,336 |
| Mbao | 1,243 |
| Keur Massar | 1,280 |
| Sacré Cœur | 1,392 |

**Mais le coefficient est d'abord calibré sur l'historique du tenant lui-même**
(`calibrerCoeff`), et reste ajustable à l'écran. Le calibrage est refusé si
l'historique compte moins de 28 jours ou si le rythme P2 est nul — on ne calibre
pas sur du vide, et l'écran dit alors d'où vient le coefficient utilisé.

---

## 3. Les rythmes journaliers

Pour chaque période (P1, P2), le rythme retenu suit une cascade :

1. **Au moins `minJours` (5) jours observés** → `70 % du réel + 30 % de l'historique`
2. **Moins de 5 jours** → historique seul — *deux jours ne font pas une moyenne*
3. **Pas d'historique** → conversion depuis l'autre période via le coefficient

La pondération 70/30 est **réglable à l'écran**. La source retenue est toujours
affichée : « 70 % réel + 30 % historique », « historique », « converti depuis P1 ».

### Les jours sans vente sortent du dénominateur

Règle **inversée le 19/08/2026, sur mesure**. Auparavant un jour ouvré sans
vente comptait zéro au dénominateur, au motif qu'un jour ouvert sans vente est
une information. Les données disent le contraire : une boucherie ouverte qui ne
vend rien de la journée n'existe pas. Ces jours sont des fermetures ou des
saisies manquantes (Mbao en a quatre consécutifs du 27 au 30 mai, quatre en
juin). Chacun divisait le rythme sans rien apporter au numérateur, et comme la
fenêtre d'historique de 92 jours en contient toujours, l'effet contaminait même
les mois sains.

Backtest sur 16 projections, deux sites (Mbao et Keur Massar), juin et juillet
2026, quatre dates de coupe par mois :

| Règle | Erreur absolue moyenne | Biais moyen | Pire cas |
|---|---|---|---|
| jours à zéro comptés | 43,4 % | −41,4 % | −76 % |
| **jours à zéro exclus** | **17,5 %** | **−10,8 %** | −56 % |

Gain confirmé séparément sur chaque site : Mbao 46,3 → 15,7 %, Keur Massar
40,5 → 19,2 %. Aucun paramètre n'a été ajusté : c'est la correction d'un défaut.

`rythmeParType` rend `joursExclus`, la liste des journées écartées, pour que
l'écran puisse les nommer. Si la boutique était réellement fermée, c'est une
information de gestion ; si la saisie manque, il faut la faire.

**Ce qui n'a PAS été touché, et pourquoi.** Le balayage du poids du réel donne
un minimum d'erreur à 40 % (18,1 %) contre 25,9 % à 70 %, mais sur trois mois
seulement et avec des dates de coupe non indépendantes : trois observations
réelles. Déplacer le curseur là-dessus serait du surapprentissage. Le découpage
P1/P2 a lui aussi été mis en doute — un modèle plat le battait à 19,2 % contre
25,9 % — mais uniquement parce que les jours à zéro l'empoisonnaient davantage.
Corrigé, P1/P2 gagne sur les deux sites (17,5 % contre 26,0 %). Les approches
mixtes (moyenne, médiane, min, max de deux modèles) se placent toutes entre
leurs composants, jamais au-dessus du meilleur.

**Attention à l'asymétrie qui subsiste** : le rythme se calcule par jour
*actif*, puis se multiplie par les jours *ouvrés* restants. Si des journées à
venir sont fermées, la projection les compte comme actives. Le biais résiduel
étant négatif (−10,8 %, donc sous-projection), cet effet est dominé par
d'autres, mais il reste une piste pour la suite.

**Dimanches** : s'ils sont exclus (case à cocher), ils sortent des deux côtés — du
dénominateur des jours écoulés *et* du compte des jours restants. Les compter d'un
seul côté sous-estimerait le rythme de 17 %.

---

## 4. Le CA projeté

Deux méthodes, au choix à l'écran (« CA projeté » dans les options). Le champ
`hypotheses.ca_methode` de l'export JSON dit laquelle a servi.

### Méthode « volumes × derniers prix » (défaut)

L'extrapolation P1/P2 est aux prix de la période : ses rythmes moyennent des
journées vendues aux anciens tarifs. On la lit donc comme une proportion de
volume, puis on revalorise ce volume au dernier prix de vente connu.

```text
CA rythmes    = CA réalisé + jours P1 restants × rythme P1
                           + jours P2 restants × rythme P2
proportion    = (CA rythmes − CA réalisé) ÷ CA réalisé        (du volume)
CA plein      = Σ (quantité de la période × dernier prix de vente)
CA de la suite = proportion × CA plein
CA projeté    = CA réalisé + CA de la suite
```

Identité garantie par construction, contrôlée dans le bloc debug :
`Σ(quantité restante × dernier prix de vente) = CA projeté − CA réalisé`.

Le parage n'entre pas dans le CA : il ne touche que le coût (1 kg vendu
consomme 1/(1−parage) kg de carcasse), déjà porté par la marge unitaire.

Dans `projeterPL`, la proportion de volume se lit alors sur le CA plein —
`(caCible − CA réalisé) ÷ caPleinDerniersPrix` — et les postes qui suivent la
marchandise (commission MaaS, marge CDC, avances) sont extrapolés au facteur
`1 + proportion`, pas au ratio de CA : une hausse du prix de vente n'augmente
pas une commission calculée sur le prix catalogue des livraisons.

### Méthode « rythmes P1/P2 »

L'extrapolation seule, aux prix de la période :

```text
CA estimé = CA réalisé
          + jours P1 restants × rythme P1
          + jours P2 restants × rythme P2
```

Quand les prix montent en cours de mois, cette méthode sous-estime le CA de la
suite (les rythmes traînent les anciens tarifs) ; le bloc debug affiche l'écart
avec l'autre méthode. Quand les prix n'ont pas bougé, les deux méthodes rendent
exactement le même chiffre.

---

## 5. Le PL projeté, poste par poste

Chaque poste suit une règle **différente**, et c'est le cœur du modèle :

| Poste | Règle | Pourquoi |
|---|---|---|
| Ventes | le CA estimé | — |
| Commission MaaS, avances, marge CDC | **proportionnels au CA** | ils suivent l'activité |
| Dépenses | **réalisées à date, non extrapolées** | ce sont des actes ponctuels, pas des flux |
| Avances, paiements fournisseur, variation de stock | **entrent dans le coût RÉALISÉ** (donc dans le taux constaté), pas dans la marge future | ils décrivent ce qui a déjà été payé ; les jours restants sont valorisés aux prix du jour (§ 14 bis) |
| Charges fixes | **le mois COMPLET** (plus de prorata) | une charge mensuelle sera due en entier |
| Variation de stock | au choix : « garder » ou « zéro » | c'est une **photo**, pas un flux |

La variation de stock est le poste le plus discutable : c'est pourquoi elle est un
**choix explicite à l'écran** plutôt qu'une règle cachée.

### Le taux de marge

`projeterPL` n'applique pas la marge poste par poste : il utilise le **taux de
marge** de la période (`taux_marge`), et à défaut le reconstitue :

```text
coût réel   = avances + paiements fournisseur − variation de stock nette
taux marge  = (CA réalisé − coût réel) / CA réalisé
marge       = CA cible × taux marge
PL          = marge − commission + marge CDC − charges − dépenses
```

**Conséquence à connaître** : si `caRealise <= 0`, `projeterPL` rend `null` —
règle du document, *on n'invente pas*.

> **Cette formule ne décrit que le repli.** Quand le taux aux prix du jour est
> disponible et suffisamment couvrant, la marge n'est plus `CA cible × taux` mais
> une **décomposition passé / futur** — voir la section 14 bis. Le taux ci-dessus
> reste alors celui du seul réalisé.

---

## 6. Les trois scénarios

- **Prudent** : CA −10 %
- **Central** : CA estimé
- **Haut** : CA +10 %

Les postes proportionnels au CA sont recalculés dans chaque scénario. Les charges
fixes, dépenses et paiements **ne bougent pas** — règle du document.

---

## 7. Le niveau de confiance

| Niveau | Condition |
|---|---|
| **bon** | les périodes touchées ont ≥ 5 jours observés **et** un historique |
| **moyen** | une seule source manque |
| **faible** | une source de données du PL est indisponible, ou un rythme vient d'une conversion |

**Règle du document** : sans données de coût fiables, on ne projette **que le CA**,
et l'écran le dit au lieu d'afficher un PL inventé.

---

## 8. Les volumes projetés

Le CA projeté ne dit pas combien de **marchandise** il suppose. C'est pourtant ce
chiffre-là qui se commande.

```text
reste à vendre (produit p) = quantité vendue (p) × proportion des jours restants
```

Chaque produit **garde sa part du mélange** — même hypothèse que `effetSurLaSuite`,
qui multiplie déjà les quantités par la même proportion. En prendre une autre
ferait diverger deux lectures du même mois.

### Hypothèse affichée, pas tue

Les volumes sont calculés **à prix de vente inchangé**. Un tarif relevé pour la
suite ferait le même chiffre d'affaires avec moins de kilos. C'est écrit sous le
tableau plutôt que laissé implicite.

### Ce qui est exclu, et nommé

- Un bovin **sans vente depuis le 1er** est hors tableau (on ne sait pas
  extrapoler depuis zéro) — mais il est **nommé** sous le tableau.
- Un produit **sans marge chiffrable** est exclu du partage plutôt que compté à
  zéro : l'inclure au dénominateur diluerait la moyenne et gonflerait les kilos
  demandés.

---

## 8 bis. La saisie manuelle des quantités restantes

Dans le tableau des volumes, la colonne « Reste à vendre » est saisissable. Le
placeholder porte la valeur de l'hypothèse de mix : un champ vide rend
exactement le comportement d'avant cette fonctionnalité, au franc près.

### Pourquoi une saisie et non un estimateur

Un estimateur statistique par produit a été construit et backtesté avant d'être
écarté, puis réévalué. L'histoire vaut d'être connue :

- première mesure, sur Mbao seul et **avec** le défaut des jours à zéro : la
  projection par produit dégradait le résultat, verdict négatif ;
- seconde mesure, après correction du défaut et sur deux sites : elle gagne sur
  **les six produits suivis, sans exception** (bœuf en détail +1,5 pt, bœuf en
  gros +7,7, poulet en détail +1,7, foie +34,9, yell +7,2, jarret +8,7).

Le premier verdict était donc faux, produit sur un modèle bugué. La leçon vaut
au-delà de ce cas : **une mesure faite sur un modèle défectueux mesure le
défaut, pas le modèle.**

Reste que même le meilleur modèle laisse le bœuf en gros à 88 % d'erreur. La
cause est identifiée : une commande unique de 189 unités le 20/06/2026, 774 900 F,
21 % du CA du mois. Aucun rythme ne prédit cet événement, mais l'exploitant le
connaît d'avance. C'est exactement ce que la saisie couvre.

### Les deux modes

**« redistribue à CA projeté constant »** (défaut) : la saisie ne change que le
mix, le CA projeté ne bouge pas. Les lignes non saisies absorbent la différence
au prorata, et l'écran affiche le facteur appliqué. C'est le mode juste pour
corriger une répartition.

**« s'ajoute au CA projeté »** : la saisie vient en plus. Pour une commande qui
s'ajoute à l'activité habituelle.

### Règles de saisie

- champ **vide** = hypothèse de mix ;
- **zéro** saisi est une information distincte et légitime (« plus de gros ce
  mois-ci »), jamais confondue avec un champ vide ;
- une valeur négative est ramenée à zéro ;
- si les saisies dépassent à elles seules le CA projeté, les lignes libres
  tombent à zéro, le total dépasse la projection, et l'écran le signale en rouge
  plutôt que de rendre des quantités négatives ;
- la clé de rapprochement est celle du serveur (`normaliserNom` : accents
  retirés, minuscules), donc « Boeuf En Gros » et « Boeuf en gros » sont le même
  produit.

### Effet sur les scénarios

La saisie vaut dans **les trois** scénarios : une commande annoncée ne rétrécit
pas parce qu'on regarde le scénario prudent. Ce sont les lignes libres qui
absorbent la variation de volume. Une première écriture figeait la saisie au
seul scénario central et cassait la monotonie des trois colonnes — le prudent
affichait un PL supérieur au central. Un test l'a rattrapée.

### Contrôles

Sans saisie, le bloc debug vérifie que la somme produit par produit égale
`proportion × marge du mix` : c'est la preuve qu'aucune régression n'a été
introduite. Avec saisie, les deux **doivent** différer, et le bloc affiche donc
l'écart chiffré au lieu d'un contrôle.

---

## 9. Le Δ équilibre et le PL cible

### Le PL cible

Zéro par défaut — l'équilibre — mais **ne pas perdre n'est pas un objectif
d'exploitation**. Le champ « Objectif de PL fin de mois » accepte n'importe quelle
valeur, y compris **négative** (accepter de perdre 50 000 F ce mois-ci est un
arbitrage, pas une erreur de saisie).

```text
manque = cible − PL central
```

Le réglage vit **hors** du bloc qu'il pilote : dès que la cible est atteinte le
plan disparaît, et l'enfermer dedans aurait supprimé le seul moyen de la relever.

### Le Δ équilibre

```text
marge moyenne = Σ(quantité × marge nette) / Σ quantité     [pondérée, pas simple]
Δ total       = manque / marge moyenne
Δ (produit p) = Δ total × (quantité p / Σ quantité)
```

Le **signe est conservé** : un PL au-dessus de la cible donne un Δ négatif — le
coussin, exprimé en marchandise. C'est précisément le cas où le plan d'équilibre
se tait, faute d'avoir quelque chose à combler.

### La marge utilisée

`margeApresCommission` — **pas** la marge brute de parage. Vendre une unité de plus
fait livrer `1/(1−parage)` unité de carcasse, qui est commissionnée au prix
catalogue fournisseur.

> **Incident historique** : les deux moitiés de l'écran se contredisaient — le plan
> promettait de combler 2 500 000 F là où le moteur n'en rendait que 2 100 000.
> C'est pourquoi la même fonction de marge est passée à `planEquilibre`,
> `volumesProjetes` **et** `recommandations`.

---

## 10. Le prix conseillé

Seconde lecture du **même** manque : au lieu de « combien de kilos en plus », « à
quel prix vendre ce qui reste ».

```text
prix requis (p) = prix actuel (p) + (part du manque de p) / (kilos restants de p)
```

Répartition au **même ratio** que le Δ équilibre — deux clés de partage différentes
sur le même écran se contrediraient.

**Le coût n'est pas recalculé ici.** `margeApresCommission` divise déjà le coût
carcasse (au dernier prix connu) par `(1 − parage)` et déduit la commission
induite. Une seconde division ici en ferait une formule libre de diverger. La
formule partagée est `prixPourCombler()`, utilisée par `planEquilibre` et
`volumesProjetes`.

### Conséquence mathématique à connaître

L'écart en F/kg sort **identique** pour tous les produits. C'est inévitable :
répartir un manque au prorata des kilos, puis diviser par un reste-à-vendre
lui-même proportionnel à ces kilos, annule le poids de chaque produit. Le résultat
revient à « appliquez la même hausse au kilo sur tout le bœuf », ce qui reste
correct — la somme des marges supplémentaires égale bien le manque total. Seuls les
**prix absolus** diffèrent, parce que les prix de départ diffèrent.

**Si l'on voulait que les produits à forte marge absorbent plus d'effort**, il
faudrait pondérer par la marge plutôt que par le volume — c'est ce que fait déjà le
*Plan B* du plan d'équilibre.

---

## 11. Le plan d'équilibre (Plan A / Plan B)

**Plan A** — tout jouer sur un seul produit, de deux façons :

- à volume inchangé → monter la marge (et donc le prix)
- à marge inchangée → vendre plus

**Plan B** — répartir sur plusieurs produits, pris par marge unitaire décroissante,
chacun portant une part **proportionnelle à sa marge**. Conséquence : à effort égal,
ce sont les fortes marges qui rapportent le plus. Un produit plafonné cède son
reliquat aux autres, par paliers.

Le **plafond par produit** (`facteurMax`, défaut 3) borne l'effort à un multiple du
rythme mensuel : sans lui, le plan proposerait des volumes que personne ne peut
écouler.

Quand même au plafond les produits ne suffisent pas, l'écran le **dit** :
« l'équilibre ne se joue pas sur le seul volume ce mois-ci ».

---

## 12. Les hypothèses, rassemblées

Ce que le modèle **suppose**, et qu'il faut accepter ou changer :

| Hypothèse | Réglable ? | Risque si fausse |
|---|---|---|
| Le mois suit le régime P1/P2 | coefficient oui | rythme mal réparti entre début et milieu de mois |
| 70 % réel + 30 % historique | oui | un mois atypique tire trop, ou pas assez |
| Commission, avances, marge CDC ∝ CA | non | ces postes suivent en réalité autre chose |
| Dépenses et paiements non extrapolés | oui (option) | sous-estime si des dépenses restent à venir |
| Charges fixes en entier | non | — (c'est la réalité d'une charge mensuelle) |
| Variation de stock « photo » | oui (option) | le stock final réel diffère |
| Chaque produit garde sa part du mélange | non | un produit qui décolle fausse la répartition |
| Prix de vente inchangé pour la suite | champ « prix pour la suite » | volumes surestimés si les prix montent |
| Le parage mesuré vaut pour la suite | oui | coût de la carcasse mal estimé |

---

## 13. Recommandations d'usage

1. **Lire le niveau de confiance avant le PL projeté.** Un PL « faible » repose sur
   une conversion ou une source manquante — le chiffre existe, sa fiabilité non.

2. **Regarder les trois scénarios, pas seulement le central.** L'écart entre prudent
   et haut dit combien la projection est sensible ; s'il dépasse les postes qu'on
   discute, la discussion porte sur du bruit.

3. **Vérifier la source des rythmes.** « Converti depuis P1 » signifie qu'aucune
   journée P2 n'a encore été observée : la moitié du mois est extrapolée.

4. **Traiter le Δ équilibre et le prix conseillé comme deux leviers du même manque**,
   jamais comme deux efforts à cumuler.

5. **Ne pas figer un PL dont le stock du soir est estimé** — le bouton le refuse
   déjà, mais la projection, elle, l'accepte : le chiffre bougera au comptage.

6. **Utiliser le PL cible plutôt que l'équilibre** dès qu'un objectif existe. Viser
   zéro quand on veut dégager 100 000 F rend l'écran muet exactement quand il
   servirait.

---

## 14. Export JSON

Le bouton **Export JSON** de la section Projection télécharge la **couche calculée**
— rythmes et leurs sources, scénarios, volumes, plan d'équilibre, prix conseillé,
recommandations — accompagnée des **hypothèses en vigueur** (pondération,
coefficient, parage, cible, options).

Ce n'est **pas** le payload brut du serveur : celui-ci porte des champs internes
sans intérêt et n'a pas la structure des scénarios ni du plan. Le fichier est
structuré pour qu'un LLM y trouve les conclusions, pas pour qu'il ait à les
rebâtir.

Le fichier porte un bloc `a_propos` qui explique en clair ce que chaque section
contient — un lecteur automatique ne doit pas avoir à deviner d'après les clés.

---

## 14 bis. Le taux de marge de la projection

Le PL projeté ne s'obtient pas en appliquant un taux unique au chiffre d'affaires
du mois. **Le mois est coupé en deux, chaque moitié à son prix :**

```text
marge = CA réalisé × taux constaté          ← un fait, jamais réévalué
      + proportion × marge aux prix du jour  ← seuls les jours restants
```

où `proportion = (CA projeté − CA réalisé) ÷ CA réalisé`.

**Le taux constaté** — `(CA − avances − paiements + variation de stock) ÷ CA` — est
une mesure de **trésorerie**. Une carcasse reçue et pas encore vendue fait sortir
l'argent tout de suite et fait plonger le taux, sans qu'aucune rentabilité n'ait
changé : mesuré sur Mbao, il est passé de +9,99 % à −10,14 % en une journée. Il
décrit correctement le passé, mais projeter dessus supposerait que les jours
restants reproduisent le calendrier des livraisons du mois écoulé.

**Le taux aux prix du jour** — `Σ (prix de vente − prix d'achat ÷ (1 − parage)) ×
quantité ÷ CA` — repose sur le **dernier prix d'achat connu** et le **dernier prix
de vente constaté**. La commission n'y entre pas : elle est déjà un poste du PL,
la compter ici la déduirait deux fois.

**Pourquoi la décomposition.** Appliquer le taux aux prix du jour à tout le mois
réévaluerait les ventes déjà faites à des prix qu'elles n'ont pas eus — une vente
conclue à 5 282 F recomptée 5 400 F. Sur un cas réel, cette erreur gonflait le PL
projeté de 151 421 F à 293 427 F, soit près du double.

**Garde-fou.** Le taux aux prix du jour n'est retenu que s'il couvre au moins 80 %
du chiffre d'affaires ; en dessous, le taux constaté reprend la main. Les produits
sans coût connu sont **exclus** du calcul, jamais comptés à zéro, et sont nommés.
En dessous de 99 % de couverture, un badge d'avertissement l'affiche.

Le mode **debug** rend la dérivation complète : chaque produit avec son prix de
vente, son coût, son diviseur de parage, sa marge unitaire et sa contribution,
puis la chaîne qui mène du taux au PL projeté — avec un contrôle qui recalcule la
marge indépendamment et la compare à celle du module.

---

## 15. Tests

`tests/simulation-v2-projection.test.js` — **111 tests**.

Principe : les valeurs attendues sont recalculées par des **expressions
indépendantes**, jamais en appelant le module. *Un test qui compare le module à
lui-même ne teste rien.*

> **Incident à retenir** : un test affirmait `variation = (fin − départ) × coeff` et
> passait, parce que le code appliquait la même règle fausse — code et test
> partageaient la prémisse. Seules les données réelles l'ont montré. La vraie règle
> est `boucherie × coefficient + hors boucherie` : le coefficient de pertes de
> découpe ne porte que sur la viande, l'épicerie ne se pare pas.
