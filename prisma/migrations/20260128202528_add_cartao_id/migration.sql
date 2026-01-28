-- AlterTable
ALTER TABLE "Evento" ADD COLUMN     "lembrete" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "transacoes" ADD COLUMN     "cartaoId" TEXT,
ADD COLUMN     "parcelaInfo" TEXT;
