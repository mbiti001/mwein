<?php
require_once __DIR__.'/common.php';
function care_totals_tables(): void {
    db()->exec("CREATE TABLE IF NOT EXISTS care_totals_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patients INTEGER NOT NULL CHECK(patients BETWEEN 0 AND 1000000000),
        encounters INTEGER NOT NULL CHECK(encounters BETWEEN 0 AND 1000000000),
        recorded_on TEXT NOT NULL, created_at TEXT NOT NULL, note TEXT NOT NULL, actor TEXT NOT NULL
    )");
    run('INSERT OR IGNORE INTO care_totals_history(id,patients,encounters,recorded_on,created_at,note,actor) VALUES(1,6255,13557,?,?,?,?)',
        ['2026-09-27',date('c'),'Initial confirmed HMIS dashboard snapshot.','Initial release']);
}
function care_totals_current(): array {
    care_totals_tables();
    return rows(run('SELECT * FROM care_totals_history ORDER BY id DESC LIMIT 1'))[0];
}
