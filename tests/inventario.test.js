import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularStatusConciliacao, chaveBobina, determinarFilial, montarRelatorioConciliado, processarEntradaMassa
} from '../src/lib/inventario.js';
import { campoCSV } from '../src/lib/csv.js';

test('filial pelo prefixo do lote, com Videira como padrão', () => {
  assert.equal(determinarFilial('MA123456'), '1003');
  assert.equal(determinarFilial('ra123456'), '1005');
  assert.equal(determinarFilial('UV123456'), '1006');
  assert.equal(determinarFilial('5001828190'), '1001');
  assert.equal(determinarFilial(''), null);
});

test('LOTE: etiqueta GS1 (7), formato compacto, tag VL e termo isolado', () => {
  assert.deepEqual(processarEntradaMassa('E(0)301184(1)HEINZ BRAS(7)005001823781(8)1005', 'LOTE'), [{ tipo: 'lote', valor: '5001823781' }]);
  assert.deepEqual(processarEntradaMassa('R5001823781C9056435UMILQ2.700', 'LOTE'), [{ tipo: 'lote', valor: '5001823781' }]);
  assert.deepEqual(
    processarEntradaMassa('VL12LT VA123456 VA654321KG', 'LOTE'),
    [{ tipo: 'lote', valor: 'VA123456' }, { tipo: 'lote', valor: 'VA654321' }]
  );
  assert.deepEqual(processarEntradaMassa('va123456\nVA123456', 'LOTE'), [{ tipo: 'lote', valor: 'VA123456' }]);
  assert.deepEqual(processarEntradaMassa('OP123456', 'LOTE'), []);
  assert.deepEqual(processarEntradaMassa('VA123456 VA654321', 'LOTE'), [], 'linha com vários termos é ignorada');
});

test('LOTE: agrupador expande nos lotes da planilha SAP', () => {
  const csv = [
    { codigo: 'VA111111', lote: 'VA111111', agrupador: '77' },
    { codigo: 'VA222222', lote: 'VA222222', agrupador: '77' },
    { codigo: 'VA333333', lote: 'VA333333', agrupador: '88' },
  ];
  assert.deepEqual(
    processarEntradaMassa('AG0077', 'LOTE', csv).map(i => i.valor),
    ['VA111111', 'VA222222']
  );
});

test('ROMANEIO: só números de 6 a 16 dígitos; tag VL é descartada', () => {
  assert.deepEqual(processarEntradaMassa('000123456', 'ROMANEIO'), [{ tipo: 'romaneio', valor: '123456' }]);
  assert.deepEqual(processarEntradaMassa('VA123456', 'ROMANEIO'), []);
  assert.deepEqual(processarEntradaMassa('VL1LT 123456789', 'ROMANEIO'), []);
});

test('conciliação: endereço igual, Rota-Gaveta e local incorreto', () => {
  const depositos = [{ id: '9000', requerEndereco: true }];
  const sapPosicao = { lote: 'VA1', posicao: 'R04D-04C' };
  const lida = { endereco_lido: 'Depósito: 9000 | G: A | P: 04C' };
  assert.equal(calcularStatusConciliacao(lida, sapPosicao, 'R04D', depositos).tipo, 'ok');
  assert.equal(calcularStatusConciliacao(lida, sapPosicao, 'R01A', depositos).tipo, 'divergencia');
  assert.equal(calcularStatusConciliacao(lida, null, 'R04D', depositos).tipo, 'sobrando');
  assert.equal(calcularStatusConciliacao({ endereco_lido: null }, sapPosicao, '-', depositos).tipo, 'ok');
});

test('relatório na tela: romaneio com várias bobinas, sobra e faltando', () => {
  const csvBobinas = [
    { codigo: '500100', romaneio: '500100', deposito: '9000' },
    { codigo: '500100', romaneio: '500100', deposito: '9000' },
    { codigo: '500200', romaneio: '500200', deposito: '9000' },
  ];
  const bobinasLidas = [
    { codigo: '500100', romaneio: '500100' },
    { codigo: '999999', romaneio: null },
  ];
  const rel = montarRelatorioConciliado({ bobinasLidas, csvBobinas });
  assert.equal(rel.find(r => r.codigo === '500100' && r.tipo !== 'faltando').tipo, 'ok');
  assert.equal(rel.find(r => r.codigo === '999999').tipo, 'sobrando');
  assert.deepEqual(rel.filter(r => r.tipo === 'faltando').map(r => r.codigo), ['500200']);
});

test('chave de conciliação ignora zeros à esquerda e caixa', () => {
  assert.equal(chaveBobina('00va123', null), 'lote_VA123');
  assert.equal(chaveBobina('VA123', '000555'), 'rom_555');
});

test('CSV: aspas escapadas, separadores protegidos e fórmula neutralizada', () => {
  assert.equal(campoCSV(null), '-');
  assert.equal(campoCSV(0), '0');
  assert.equal(campoCSV('BOBINA #12'), 'BOBINA #12');
  assert.equal(campoCSV('A;B'), '"A;B"');
  assert.equal(campoCSV('diz "oi"'), '"diz ""oi"""');
  assert.equal(campoCSV('=1+1'), "'=1+1");
});
