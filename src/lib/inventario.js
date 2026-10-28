// src/lib/inventario.js — Regras de negócio puras do inventário (sem React, sem rede).
// Extraídas de App.jsx sem mudança de comportamento, para poderem ser testadas e reutilizadas.

export const limparCodigo = (codigo) => {
  if (!codigo) return '';
  return String(codigo).replace(/^0+/, '');
};

export const determinarFilial = (lote) => {
  if (!lote) return null;
  const prefixo = lote.toUpperCase().substring(0, 2);
  if (prefixo === 'MA') return '1003';
  if (prefixo === 'RA') return '1005';
  if (prefixo === 'UA' || prefixo === 'UV') return '1006';
  if (prefixo === 'TA') return '1007';
  if (prefixo === 'ZA') return '1009';
  if (prefixo === 'FA') return '1010';

  // Qualquer outro formato de lote (ou prefixo VA) assume-se como filial de Videira (1001)
  return '1001';
};

export const removerZeros = (val) => {
  if (!val) return null;
  const limpo = val.trim().replace(/^0+/, '');
  return limpo === '' ? '0' : limpo;
};

/** Chave única de uma bobina para conciliação: romaneio tem prioridade sobre lote. */
export const chaveBobina = (lote, romaneio) => {
  const rom = limparCodigo(romaneio);
  if (rom && rom !== '-') return `rom_${rom}`;
  return `lote_${limparCodigo(lote).toUpperCase()}`;
};

/**
 * Todas as chaves pelas quais uma bobina pode ser reconhecida (lote e, se houver, romaneio).
 * Em contagem por romaneio o "lote" gravado é o próprio número do romaneio, então conciliar
 * por qualquer uma das chaves evita falsos "faltando" quando só um lado tem o romaneio.
 */
export const chavesDaBobina = (lote, romaneio) => {
  const chaves = [];
  if (lote) chaves.push(chaveBobina(lote, null));
  if (romaneio && romaneio !== '-') chaves.push(chaveBobina(null, romaneio));
  return chaves;
};

export const formatarEnderecoSAP = (bobina, depositos = []) => {
  if (!bobina) return '-';
  if (bobina.posicao && !bobina.deposito) {
    return `Posição: ${bobina.posicao}`;
  }
  if (bobina.gondola || bobina.posicao) {
    return `Depósito: ${bobina.deposito || '-'} | G: ${bobina.gondola || '-'} | P: ${bobina.posicao || '-'}`;
  }
  const depInfo = depositos.find(d => d.id === bobina.deposito);
  if (depInfo && !depInfo.requerEndereco) {
    return `Depósito: ${bobina.deposito}`;
  }
  return `Depósito: ${bobina.deposito || '-'}`;
};

/** Endereço lido confere com o SAP? Aceita igualdade direta ou Rota-Gaveta == Posição SAP. */
const enderecoConfere = (enderecoLido, enderecoSapFmt, nomeRota) => {
  if (enderecoLido === enderecoSapFmt) return true;
  // Validação cruzada Rota-Gaveta. Ex: "Depósito: 9000 | G: A | P: 04C" + rota R04D -> "Posição: R04D-04C"
  const matchGaveta = enderecoLido.match(/\|\s*P:\s*([^|]+)/);
  if (matchGaveta && nomeRota && nomeRota !== '-') {
    return `Posição: ${nomeRota}-${matchGaveta[1].trim()}` === enderecoSapFmt;
  }
  return false;
};

export const calcularStatusConciliacao = (b, dadosSap, nomeRota, depositos = []) => {
  if (!dadosSap) return { status: 'Sobra (Não SAP)', tipo: 'sobrando' };
  const endereco_lido = b.endereco_lido || '-';
  const endereco_sap_fmt = formatarEnderecoSAP(dadosSap, depositos);
  if (endereco_lido === '-' || endereco_sap_fmt === '-') return { status: 'OK (Lida)', tipo: 'ok' };
  if (enderecoConfere(endereco_lido, endereco_sap_fmt, nomeRota)) return { status: 'OK (Lida)', tipo: 'ok' };
  return { status: 'Local Incorreto', tipo: 'divergencia' };
};

/**
 * Interpreta o texto lido (bipagem, câmera, drone ou digitação) e extrai lotes/romaneios.
 * @returns {{ tipo: 'lote'|'romaneio', valor: string }[]} itens únicos
 */
export const processarEntradaMassa = (textoEntrada, tipoContagem, csvBobinas = []) => {
  let itensExtraidos = [];
  if (!textoEntrada) return itensExtraidos;

  const linhas = textoEntrada.split(/[\r\n]+/);

  for (let linha of linhas) {
    linha = linha.trim().toUpperCase();
    if (!linha) continue;

    // 1. Tag GS1 / Videplast com parênteses: (7)<lote/romaneio>
    // Ex real: E(0)301184(1)HEINZ BRAS(2)...(7)5001823781(8)1005...
    if (linha.includes('(7)')) {
      const regex7 = /\(7\)\s*([A-Z0-9]+)/i;
      const match7 = regex7.exec(linha);
      if (match7) {
        const valor = removerZeros(match7[1].trim());
        if (valor && valor.length >= 4 && valor.length <= 16) {
          itensExtraidos.push({ tipo: tipoContagem === 'ROMANEIO' ? 'romaneio' : 'lote', valor });
          continue;
        }
      }
    }

    // 2. Formato Compacto 2D / Barcode reduzido: R<lote/romaneio>C<produto>...
    // Ex real: R5001823781C9056435UMILQ2.700
    const matchCompacto = linha.match(/^R([A-Z0-9]{6,16})C/i);
    if (matchCompacto) {
      const valor = removerZeros(matchCompacto[1].trim());
      if (valor) {
        itensExtraidos.push({ tipo: tipoContagem === 'ROMANEIO' ? 'romaneio' : 'lote', valor });
        continue;
      }
    }

    // 3. Se a contagem ativa for LOTE:
    if (tipoContagem === 'LOTE') {
      // 3.1. Tag de lotes VL\d+LT (canto inferior térmico)
      const matchVL = linha.match(/VL\d+LT/i);
      if (matchVL) {
        const indexFimTag = matchVL.index + matchVL[0].length;
        const restante = linha.substring(indexFimTag);

        const partesInternas = restante.split(/[\s;]+/);
        partesInternas.forEach(p => {
          let palavraLote = p.trim();
          if (!palavraLote) return;

          if (/KG/i.test(palavraLote)) {
            const partesKG = palavraLote.split(/KG/i);
            palavraLote = partesKG[0].trim();
          }

          const limpo = removerZeros(palavraLote);
          if (limpo && limpo.length >= 6 && limpo.length <= 16) {
            itensExtraidos.push({ tipo: 'lote', valor: limpo });
          }
        });
        continue;
      }

      // 3.2. Termo individual ou isolado (leitor 1D, bipagem direta ou digitação)
      const palavras = linha.split(/[\s,;\-/]+/).filter(Boolean);

      if (palavras.length === 1) {
        const termoUnico = palavras[0];
        // Descarta se contiver OP ou for cabeçalho gigante
        if (termoUnico.includes('OP') || termoUnico.length > 16) {
          continue;
        }

        const valorLimpo = removerZeros(termoUnico);
        if (!valorLimpo) continue;

        const isPrefixoAG = termoUnico.startsWith('AG');
        const agNumeroLimpo = isPrefixoAG ? removerZeros(termoUnico.substring(2)) : valorLimpo;

        // Se for agrupador e o SAP estiver carregado, expande seus lotes
        const itemSAPAgr = csvBobinas.find(c => removerZeros(c.agrupador) === agNumeroLimpo);

        if (itemSAPAgr) {
          const bobinasDoAgrupador = csvBobinas.filter(c => removerZeros(c.agrupador) === agNumeroLimpo);
          bobinasDoAgrupador.forEach(b => {
            if (b.lote) {
              itensExtraidos.push({ tipo: 'lote', valor: b.lote });
            }
          });
        } else {
          // Lote físico válido (alfanumérico com letras ou puramente numérico, ex: 5001828190)
          if (!isPrefixoAG && /^[A-Z0-9]{6,16}$/i.test(valorLimpo)) {
            itensExtraidos.push({ tipo: 'lote', valor: valorLimpo });
          }
        }
      }
    }

    // 4. Se a contagem ativa for ROMANEIO:
    if (tipoContagem === 'ROMANEIO') {
      if (/VL\d+LT/i.test(linha)) {
        continue;
      }

      const palavras = linha.split(/[\s,;\-/]+/).filter(Boolean);
      if (palavras.length === 1) {
        const termoUnico = palavras[0];
        const valorLimpo = removerZeros(termoUnico);
        if (valorLimpo && /^\d+$/.test(valorLimpo) && valorLimpo.length >= 6 && valorLimpo.length <= 16) {
          itensExtraidos.push({ tipo: 'romaneio', valor: valorLimpo });
        }
      }
    }
  }

  // Garantir unicidade
  const unicos = [];
  const chaves = new Set();
  itensExtraidos.forEach(item => {
    const chave = `${item.tipo}-${item.valor}`;
    if (!chaves.has(chave)) {
      chaves.add(chave);
      unicos.push(item);
    }
  });

  return unicos;
};

/**
 * Relatório conciliado da contagem em andamento no aparelho (bipadas x planilha SAP carregada).
 * Usa índices (Map) para não ficar O(lidas x SAP) a cada renderização.
 */
export const montarRelatorioConciliado = ({ bobinasLidas, csvBobinas, rotas = [], depositos = [] }) => {
  const sapPorCodigo = new Map();
  const sapPorRomaneio = new Map();
  csvBobinas.forEach(c => {
    if (!sapPorCodigo.has(c.codigo)) sapPorCodigo.set(c.codigo, c);
    if (c.romaneio && !sapPorRomaneio.has(c.romaneio)) sapPorRomaneio.set(c.romaneio, c);
  });
  const nomeRotaPorId = new Map(rotas.map(r => [String(r.id), r.rota]));
  const lidasCodes = new Set(bobinasLidas.map(b => b.codigo));
  const relatorio = [];

  bobinasLidas.forEach(b => {
    const bobinaSAP = (b.romaneio && b.romaneio !== '-') ? sapPorRomaneio.get(b.romaneio) : sapPorCodigo.get(b.codigo);
    const isOk = !!bobinaSAP;
    const filialFinal = b.filial || (bobinaSAP ? bobinaSAP.filial : null) || determinarFilial(b.codigo) || '-';

    const endereco_sap_formatado = formatarEnderecoSAP(bobinaSAP, depositos);
    const endereco_lido = b.endereco_lido || '-';

    // Pega o nome da Rota que o operador escolheu
    const idRotaSalvo = b.rotas || b.rota;
    const nomeRota = nomeRotaPorId.get(String(idRotaSalvo)) || idRotaSalvo || '-';

    let statusFinal = ''; let tipoFinal = '';
    if (csvBobinas.length === 0) { statusFinal = 'Bipada (Sem SAP base)'; tipoFinal = 'sobrando'; }
    else if (!isOk) { statusFinal = 'Sobrando (Não SAP)'; tipoFinal = 'sobrando'; }
    else if (endereco_lido !== '-' && endereco_sap_formatado !== '-' && !enderecoConfere(endereco_lido, endereco_sap_formatado, nomeRota)) {
      statusFinal = 'Local Incorreto'; tipoFinal = 'divergencia';
    } else {
      statusFinal = 'OK (Lida)'; tipoFinal = 'ok';
    }

    relatorio.push({
      codigo: b.codigo, status: statusFinal, dataHora: b.dataHora, cracha: b.cracha, nome_operador: b.nome, filial: filialFinal,
      lote: b.lote || b.codigo, romaneio: b.romaneio || (bobinaSAP ? bobinaSAP.romaneio : '-'),
      deposito: b.deposito || (bobinaSAP ? (bobinaSAP.deposito || '-') : '-'), agrupador: bobinaSAP ? bobinaSAP.agrupador : '-',
      endereco_lido: endereco_lido, endereco_sap: endereco_sap_formatado, material: bobinaSAP ? bobinaSAP.material : '-',
      descricao: bobinaSAP ? bobinaSAP.descricao : '-', peso_liquido: bobinaSAP ? bobinaSAP.peso_liquido : '-',
      largura: bobinaSAP ? bobinaSAP.largura : '-', espessura: bobinaSAP ? bobinaSAP.espessura : '-',
      ordem_producao: bobinaSAP ? bobinaSAP.ordem_producao : '-', ordem_venda: bobinaSAP ? bobinaSAP.ordem_venda : '-',
      cliente: bobinaSAP ? bobinaSAP.cliente : '-', nome_cliente: bobinaSAP ? bobinaSAP.nome_cliente : '-',
      rota: nomeRota,
      tipo: tipoFinal
    });
  });

  csvBobinas.forEach(c => {
    if (!lidasCodes.has(c.codigo)) {
      const filialFinal = c.filial || determinarFilial(c.codigo) || '-';
      relatorio.push({
        codigo: c.codigo, status: 'Faltando (Não Bipada)', dataHora: '-', cracha: '-', nome_operador: '-', filial: filialFinal,
        lote: c.lote || c.codigo, romaneio: c.romaneio || '-',
        deposito: c.deposito || '-', agrupador: c.agrupador || '-', endereco_lido: '-', endereco_sap: formatarEnderecoSAP(c, depositos),
        material: c.material || '-', descricao: c.descricao || '-', peso_liquido: c.peso_liquido || '-', largura: c.largura || '-',
        espessura: c.espessura || '-', ordem_producao: c.ordem_producao || '-', ordem_venda: c.ordem_venda || '-',
        cliente: c.cliente || '-', nome_cliente: c.nome_cliente || '-',
        rota: '-',
        tipo: 'faltando'
      });
    }
  });
  return relatorio;
};
