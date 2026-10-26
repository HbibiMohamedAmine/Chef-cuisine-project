import React from 'react';
import { ShieldCheck, AlertTriangle, Info } from 'lucide-react';
import { Alert, Badge, Card, CardBody, CardHeader, CardTitle, PageHeader } from '@/components/ui';

/**
 * Page statique : « Paramètres comptables à valider ».
 * Exigence explicite du cahier des charges : lister les points qui ne sont PAS
 * des vérités comptables universelles et doivent être confirmés par le comptable.
 */

interface Point {
  title: string;
  question: string;
  current: string;
  impact: string;
  where: string;
  criticality: 'high' | 'medium' | 'info';
}

const POINTS: Point[] = [
  {
    title: 'Méthode de valorisation des stocks',
    question:
      'Le coût moyen pondéré (CMP) est-il la méthode adaptée à votre activité, ou faut-il retenir le FIFO ?',
    current: 'Coût moyen pondéré (CMP) — modifiable dans Paramètres → Général.',
    impact:
      'Change la valeur du stock, donc la consommation valorisée et le ratio matière. Un changement de méthode en cours d’année doit être justifié et signalé.',
    where: 'Paramètres → Général & entreprise → Comptabilité',
    criticality: 'high',
  },
  {
    title: 'Traitement des repas du personnel',
    question:
      'Les repas du personnel doivent-ils être intégrés au coût matière servant au calcul du ratio, ou suivis séparément ?',
    current: 'Exclus du ratio par défaut (paramètre « staff_meals_in_ratio » = non).',
    impact:
      'S’ils sont exclus, leur coût est retiré du coût matière retenu. Ce choix change le ratio et doit être cohérent avec votre méthode de calcul de marge.',
    where: 'Paramètres → Objectif & alertes → Règles comptables',
    criticality: 'high',
  },
  {
    title: 'Traitement des avaries et pertes',
    question:
      'Une perte qui a déjà réduit le stock doit-elle être comptée une seconde fois au titre des charges exceptionnelles ?',
    current:
      'Non : une avarie validée est marquée « déjà incluse dans le coût consommé » et n’est jamais ajoutée une deuxième fois.',
    impact:
      'Le double comptage fausserait le ratio à la hausse. Seules les pertes n’ayant pas réduit le stock sont ajoutées explicitement.',
    where: 'Avaries → formulaire (case « déjà incluse »)',
    criticality: 'high',
  },
  {
    title: 'Définition du chiffre d’affaires HT',
    question:
      'Le CA HT retenu doit-il inclure les ventes annulées, les remises, les offerts et les consommations internes ?',
    current:
      'CA HT = ventes validées uniquement, nettes de remises, hors ventes annulées. Les repas du personnel ne sont jamais inclus.',
    impact:
      'Le ratio matière se calcule sur le CA HT de la même période. Toute différence de périmètre change le ratio.',
    where: 'Moteur de calcul (module analytique)',
    criticality: 'high',
  },
  {
    title: 'Taux et traitement de la TVA',
    question:
      'Quels taux de TVA appliquez-vous (vente sur place, à emporter, boissons) ? Êtes-vous en régime réel ou forfaitaire ?',
    current: 'Taux proposés : 0 %, 7 %, 13 %, 19 %. Taux par défaut : 19 %.',
    impact:
      'Le TTC et le HT des ventes. Le ratio matière étant calculé sur le HT, un mauvais taux fausse le ratio.',
    where: 'Paramètres → Général (taux par défaut) et fiche produit (taux par produit)',
    criticality: 'high',
  },
  {
    title: 'Cotisations sociales et paie',
    question:
      'Quels sont les taux CNSS salarié/employeur, le barème IRPP et les conventions collectives applicables ?',
    current:
      'Taux indicatifs pré-remplis, entièrement modifiables : CNSS salarié 9,18 %, CNSS employeur 16,57 %, IRPP 0 % (barème à paramétrer).',
    impact:
      'Le montant des bulletins et la masse salariale. Ces taux ne sont pas garantis par le logiciel et doivent être confirmés.',
    where: 'Paramètres → (valeurs « payroll_* ») et écran Paie',
    criticality: 'high',
  },
  {
    title: 'Exports comptables',
    question:
      'Sous quel format et avec quelle structure votre comptable souhaite-t-il recevoir les écritures (journal, plan de comptes) ?',
    current:
      'Exports CSV et Excel des mouvements, achats, avaries, transferts, stock, ventes et dépenses. Pas de plan comptable normalisé.',
    impact:
      'Un export non conforme nécessite une reprise manuelle. Aucun journal comptable au sens strict n’est produit.',
    where: 'Rapports → exports CSV / Excel ; Paie → export comptable',
    criticality: 'medium',
  },
  {
    title: 'Traitement des transferts internes',
    question:
      'Les transferts entre cuisines doivent-ils générer une écriture comptable interne (comptes de stocks par section) ?',
    current:
      'Aucun impact financier : les transferts sont neutres et servent uniquement au suivi physique par cuisine.',
    impact:
      'Si votre comptable exige une comptabilité analytique par section, un retraitement sera nécessaire.',
    where: 'Transferts (module dédié)',
    criticality: 'medium',
  },
  {
    title: 'Inventaires et écarts',
    question:
      'Comment doivent être traités les écarts d’inventaire (charges exceptionnelles, correction de stock, tolérance) ?',
    current:
      'Les écarts justifiés créent des ajustements de stock tracés, intégrés au calcul de la consommation.',
    impact:
      'Les écarts non justifiés ne peuvent pas être validés : le stock théorique reste inchangé jusqu’à justification.',
    where: 'Stock → Inventaires',
    criticality: 'medium',
  },
  {
    title: 'Nature du logiciel',
    question:
      'Ce logiciel peut-il servir de base à une déclaration fiscale ou à une comptabilité officielle ?',
    current:
      'NON. C’est un outil de gestion interne. Ce n’est ni un logiciel comptable certifié ni un système fiscal homologué.',
    impact:
      'Les rapports sont des outils de pilotage. Les déclarations doivent être établies avec votre comptable.',
    where: 'Avertissement présent dans l’application et dans chaque export',
    criticality: 'info',
  },
];

export default function AccountingNotesPage() {
  const criticals = POINTS.filter((p) => p.criticality === 'high').length;

  return (
    <div>
      <PageHeader
        icon={ShieldCheck}
        title="Paramètres comptables à valider"
        description="Points qui ne sont pas des vérités comptables universelles et doivent être confirmés par votre comptable."
      />

      <Alert tone="warning" className="mb-5" title="Avertissement">
        <p>
          Ce logiciel <strong>n’est pas un logiciel comptable certifié</strong> et{' '}
          <strong>n’est pas un système fiscal homologué</strong>. Les calculs de marge et de résultat sont
          des indicateurs de gestion, jamais des bénéfices nets fiscaux.
        </p>
        <p className="mt-2">
          {criticals} point(s) ci-dessous ont un impact direct sur vos chiffres. Faites-les valider avant
          de figer votre premier mois comptable.
        </p>
      </Alert>

      <div className="space-y-3">
        {POINTS.map((p, i) => (
          <Card key={i}>
            <CardHeader className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                  {i + 1}
                </span>
                <CardTitle className="text-base">{p.title}</CardTitle>
              </div>
              <Badge tone={p.criticality === 'high' ? 'danger' : p.criticality === 'medium' ? 'warning' : 'neutral'}>
                {p.criticality === 'high' ? 'Impact élevé' : p.criticality === 'medium' ? 'À vérifier' : 'Information'}
              </Badge>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Question à poser</p>
                <p className="mt-0.5 text-slate-700">{p.question}</p>
              </div>
              <div className="rounded-md bg-emerald-50 p-2.5 ring-1 ring-inset ring-emerald-200">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Comportement actuel</p>
                <p className="mt-0.5 text-emerald-900">{p.current}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Conséquence si mal paramétré</p>
                <p className="mt-0.5 text-slate-600">{p.impact}</p>
              </div>
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <Info className="h-3.5 w-3.5" /> Où modifier : <span className="font-medium text-slate-700">{p.where}</span>
              </p>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card className="mt-5 border-amber-200 bg-amber-50">
        <CardBody className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm text-amber-900">
            <p className="font-semibold">Liste de vérification pour votre comptable</p>
            <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs">
              <li>Méthode de valorisation retenue et date d’effet</li>
              <li>Périmètre du CA HT (remises, offerts, annulations)</li>
              <li>Traitement des repas du personnel</li>
              <li>Traitement des avaries (simple ou double comptage)</li>
              <li>Taux de TVA applicables par catégorie de produit</li>
              <li>Barème IRPP et taux CNSS en vigueur</li>
              <li>Format des exports comptables attendus</li>
            </ul>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
