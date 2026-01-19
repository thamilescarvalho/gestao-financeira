-- AlterTable
ALTER TABLE "transacoes" ADD COLUMN     "bancoId" TEXT;

-- CreateTable
CREATE TABLE "bancos" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cor" TEXT NOT NULL DEFAULT '#000000',
    "usuarioId" TEXT NOT NULL,

    CONSTRAINT "bancos_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "transacoes" ADD CONSTRAINT "transacoes_bancoId_fkey" FOREIGN KEY ("bancoId") REFERENCES "bancos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bancos" ADD CONSTRAINT "bancos_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
