/**
 * Navigačné položky sidebaru aplikácie.
 * Externe odkazy (na SharePoint) majú external: true.
 */
export const NAV_ITEMS = [
  { label: 'Domov', href: '/', external: false },
  { label: 'Novinky', href: '/novinky', external: false },
  { label: 'Kalendár', href: '/udalosti', external: false },
  { label: 'Dokumenty', href: '/dokumenty', external: false },
  { label: 'Používateľský manuál', href: '/manual', external: false },
  { label: 'Administrácia', href: '/administracia', external: false, roles: ['admin'] },
];

