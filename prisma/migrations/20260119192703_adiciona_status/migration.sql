-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_transacoes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "descricao" TEXT NOT NULL,
    "valor" REAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "categoria" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "dataPagamento" DATETIME,
    "data" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_transacoes" ("categoria", "data", "descricao", "id", "tipo", "valor") SELECT "categoria", "data", "descricao", "id", "tipo", "valor" FROM "transacoes";
DROP TABLE "transacoes";
ALTER TABLE "new_transacoes" RENAME TO "transacoes";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
