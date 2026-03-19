/**
 * seed_docs.js – naplnenie hierarchie priečinkov dokumentov
 * Spustenie: node ./db/seed_docs.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('./index');

// ── Pomocná funkcia ──────────────────────────────────────────────────────────

async function upsertFolder(client, name, parentId, sortOrder) {
  // ak priečinok s rovnakým názvom a rovnakým parentom existuje, vrátime jeho id
  const existing = await client.query(
    `SELECT id FROM doc_folders WHERE name = $1 AND parent_id IS NOT DISTINCT FROM $2`,
    [name, parentId]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const res = await client.query(
    `INSERT INTO doc_folders (name, parent_id, sort_order)
     VALUES ($1, $2, $3) RETURNING id`,
    [name, parentId, sortOrder]
  );
  return res.rows[0].id;
}

// ── Štruktúra ────────────────────────────────────────────────────────────────

const TREE = [
  {
    name: 'CENTRAL_SOR', sort: 1,
    children: [
      { name: 'CE_SOR_Coordination_Group', sort: 1 },
      { name: 'CE_SOR_Joint_Management_Board', sort: 2 },
    ],
  },
  { name: 'ENTSO-E_Bidding_Zone_SC', sort: 2 },
  { name: 'ENTSO-E_Governance_Strategic_Review_Pr', sort: 3 },
  { name: 'ENTSO-E_Pravna_a_regulacna_skupina', sort: 4 },
  {
    name: 'ENTSO-E_skupiny_pod_Boardom', sort: 5,
    children: [
      { name: 'ENTSO-E_Finance_Advisory_Group', sort: 1 },
      { name: 'ENTSO-E_PCG_Skupina_pre_politiku_a_komunikaciu', sort: 2 },
    ],
  },
  { name: 'ENTSO-E_Stanovy', sort: 6 },
  {
    name: 'ENTSO-E_Valne_zhromazdenia', sort: 7,
    children: [
      { name: 'ENTSO-E_Stanovy', sort: 1 },
      { name: 'ENTSO-E_VZ_20240307', sort: 2 },
      { name: 'ENTSO-E_VZ_20240626', sort: 3 },
      { name: 'ENTSO-E_VZ_20241017', sort: 4 },
      { name: 'ENTSO-E_VZ_20241017 (1)', sort: 5 },
      { name: 'ENTSO-E_VZ_20241211', sort: 6 },
      { name: 'ENTSO-E_VZ_20250326', sort: 7 },
      { name: 'ENTSO-E_VZ_20250625', sort: 8 },
      { name: 'ENTSO-E_VZ_20251022', sort: 9 },
      { name: 'ENTSO-E_VZ_20251210', sort: 10 },
    ],
  },
  {
    name: 'ENTSO-E_Vybor_ICT', sort: 8,
    children: [
      { name: 'Enterprise_Architecture_WG', sort: 1 },
    ],
  },
  { name: 'ENTSO-E_Vybor_pre_prevadzku_sustavy', sort: 9 },
  { name: 'ENTSO-E_Vybor_pre_rozvoj_sustavy', sort: 10 },
  {
    name: 'ENTSO-E_Vybor_pre_trh', sort: 11,
    children: [
      {
        name: '260129_MC+All TSOs', sort: 1,
        children: [
          { name: 'All TSOs', sort: 1 },
          { name: 'Market Committee', sort: 2 },
        ],
      },
    ],
  },
  {
    name: 'ENTSO-E_Vybor_vyskum_vyvoj_a_inovacie', sort: 12,
    children: [
      { name: '01_General', sort: 1 },
      { name: '02_Zasadnutia RDIC', sort: 2 },
      { name: '03_WG Transmission Grid Technologies (WG TGT) former WG1', sort: 3 },
      { name: '04_WG Security and Operations of Tomorrow - ex WG2', sort: 4 },
      { name: '05_WG Future Energy Systems - ex WG4', sort: 5 },
      { name: '06_WG Digital and Communication - ex WG5', sort: 6 },
      { name: '07_WG RDIP', sort: 7 },
      { name: '08_TF Uptake Innovation Coordination - ex TF DIC', sort: 8 },
      { name: '09_TF Space for TSOs - ex Space4TSOs', sort: 9 },
      { name: '10_TF Hosting Capacities', sort: 10 },
      { name: '11_TF DESAP (Digitalization of Energy Systems Action Plan)', sort: 11 },
      { name: '12_Projekty', sort: 12 },
    ],
  },
  {
    name: 'IMPLEMENTACNE_projekty_GL-EB', sort: 13,
    children: [
      { name: 'Joint_OPSCOM_PICASSO_OPSCOM-MARI_OC', sort: 1 },
      { name: 'Joint_Steering_Committee_MARY-PICASSO-IGCC', sort: 2 },
    ],
  },
  {
    name: 'JAO_Joint_Allocation_Office', sort: 14,
    children: [
      { name: 'JAO_Joint_Service_Council', sort: 1 },
      { name: 'JAO_statutarne_dokumenty', sort: 2 },
      { name: 'JAO_Valne_zhromazdenia', sort: 3 },
    ],
  },
  {
    name: 'PROFESIJNE_organizacie', sort: 15,
    children: [
      { name: 'CIGRE', sort: 1 },
      { name: 'EURELECTRIC', sort: 2 },
      { name: 'Next_Generation_Network', sort: 3 },
    ],
  },
  {
    name: 'REGION_pre_vypocet_kapacity', sort: 16,
    children: [
      { name: 'Central_Europe_CCR', sort: 1 },
      { name: 'Core_CCR', sort: 2 },
      { name: 'Core_Flow-based_Market_Coupling', sort: 3 },
      { name: 'Eastern_Europe_CCR', sort: 4 },
      { name: 'Market_Coupling-SDAC_plus_SIDC', sort: 5 },
    ],
  },
  {
    name: 'TSCNET_Services_GmbH_TSC', sort: 17,
    children: [
      { name: '1._Strategy_Meeting_TSCNET_2026', sort: 1 },
      { name: '2025_Joint_Management_Board', sort: 2 },
      { name: '2025_TSCNET_Management_Board', sort: 3 },
      { name: '2026_TSCNET_Management_Board', sort: 4 },
      { name: '20250506_VZ_TSCNET', sort: 5 },
      { name: '20251030_VZ_TSCNET', sort: 6 },
    ],
  },
  { name: 'URSO_ACER', sort: 18 },
];

// ── Rekurzívne vkladanie ──────────────────────────────────────────────────────

async function insertTree(client, nodes, parentId = null) {
  for (const node of nodes) {
    const id = await upsertFolder(client, node.name, parentId, node.sort);
    if (node.children?.length) {
      await insertTree(client, node.children, id);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertTree(client, TREE, null);
    await client.query('COMMIT');
    const { rows } = await client.query('SELECT COUNT(*) FROM doc_folders');
    console.log(`✅ Seed dokončený – ${rows[0].count} priečinkov v DB`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed zlyhal:', err.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
})();
