/**
 * The studio. Phase 0 is the shell; scene parameters, the modulation-matrix table,
 * transport + arc scrubbing, and Patch import/export arrive in Phase 1 — each
 * running against a live engine instance (brief §11).
 */
export function StudioView() {
  return (
    <div className="studio">
      <header className="studio__bar">
        <h1 className="studio__title">Borland</h1>
        <span className="studio__tag">studio</span>
      </header>
      <div className="studio__body">
        <section className="panel">
          <p className="panel__label">v1 · phase 0</p>
          <p className="muted">
            The authoring surface. Scene parameters, the modulation-matrix table,
            transport with arc scrubbing, and Patch import and export arrive in Phase 1,
            each running against a live engine instance.
          </p>
          <p className="muted">
            For now the scaffold is in place: the Patch schema validates and round-trips,
            and the engine boots behind a single tap in the player.
          </p>
          <p className="muted">
            <a className="link" href="/">
              return to the player
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
