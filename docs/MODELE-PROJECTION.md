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

**Piège traité** : un jour sans vente compte **zéro**, il n'est pas ignoré. Deux
jours vendus sur dix écoulés donnent un rythme dilué d'autant — c'est voulu.

**Dimanches** : s'ils sont exclus (case à cocher), ils sortent des deux côtés — du
dénominateur des jours écoulés *et* du compte des jours restants. Les compter d'un
seul côté sous-estimerait le rythme de 17 %.

---

## 4. Le CA projeté

```
CA estimé = CA réalisé
          + jours P1 restants × rythme P1
          + jours P2 restants × rythme P2
```

---

## 5. Le PL projeté, poste par poste

Chaque poste suit une règle **différente**, et c'est le cœur du modèle :

| Poste | Règle | Pourquoi |
|---|---|---|
| Ventes | le CA estimé | — |
| Commission MaaS, avances, marge CDC | **proportionnels au CA** | ils suivent l'activité |
| Dépenses, paiements fournisseur | **réalisés à date, non extrapolés** | ce sont des actes ponctuels, pas des flux |
| Charges fixes | **le mois COMPLET** (plus de prorata) | une charge mensuelle sera due en entier |
| Variation de stock | au choix : « garder » ou « zéro » | c'est une **photo**, pas un flux |

La variation de stock est le poste le plus discutable : c'est pourquoi elle est un
**choix explicite à l'écran** plutôt qu'une règle cachée.

### Le taux de marge

`projeterPL` n'applique pas la marge poste par poste : il utilise le **taux de
marge** de la période (`taux_marge`), et à défaut le reconstitue :

```
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

```
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

## 9. Le Δ équilibre et le PL cible

### Le PL cible

Zéro par défaut — l'équilibre — mais **ne pas perdre n'est pas un objectif
d'exploitation**. Le champ « Objectif de PL fin de mois » accepte n'importe quelle
valeur, y compris **négative** (accepter de perdre 50 000 F ce mois-ci est un
arbitrage, pas une erreur de saisie).

```
manque = cible − PL central
```

Le réglage vit **hors** du bloc qu'il pilote : dès que la cible est atteinte le
plan disparaît, et l'enfermer dedans aurait supprimé le seul moyen de la relever.

### Le Δ équilibre

```
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

```
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

```
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
projeté de 293 427 F à 151 421 F, soit près du double.

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
