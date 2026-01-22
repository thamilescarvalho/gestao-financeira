/*
  Warnings:

  - You are about to drop the column `dataSaldo` on the `bancos` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "bancos" DROP COLUMN "dataSaldo",
ADD COLUMN     "dataSaldoInicial" TIMESTAMP(3),
ALTER COLUMN "cor" DROP NOT NULL,
ALTER COLUMN "cor" SET DEFAULT '#2f855a';
