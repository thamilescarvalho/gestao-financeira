-- AlterTable
ALTER TABLE "transacoes" ADD COLUMN     "dataVencimento" TIMESTAMP(3),
ADD COLUMN     "formaPagamento" TEXT,
ADD COLUMN     "usuarioId" TEXT;

-- AddForeignKey
ALTER TABLE "transacoes" ADD CONSTRAINT "transacoes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
