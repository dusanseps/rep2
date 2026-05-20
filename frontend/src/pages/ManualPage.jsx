/**
 * ManualPage – používateľský manuál (v príprave)
 */
import MobileMenu from '../components/shared/MobileMenu.jsx';

export default function ManualPage() {
  return (
    <div class="rep-page">
      <div class="rep-page__header">
        <h1 class="rep-page__title">Používateľský manuál</h1>
        <MobileMenu />
      </div>

      <div class="rep-page__content">
        <div class="manual-soon">
          <div class="manual-soon__icon">📘</div>
          <h2 class="manual-soon__title">Manuál sa pripravuje</h2>
          <p class="manual-soon__text">
            Používateľský manuál pre aplikáciu REPRESENTATIVE bude čoskoro
            dostupný na tejto stránke.
          </p>
        </div>
      </div>
    </div>
  );
}
