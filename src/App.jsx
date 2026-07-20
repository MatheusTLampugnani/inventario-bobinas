import React, { useState, useRef, useEffect } from 'react'
import Header from './components/Header'
import Scanner from './components/Scanner'
import logoVideplast from './assets/videplast-brand.png'
import { supabase } from './supabase'
import FilterControls from './components/FilterControls'
import ProcessadorDrone from './components/ProcessadorDrone'
import db from './db'
import { useSyncManager } from './hooks/useSyncManager'
import './App.css'

const limparCodigo = (codigo) => {
    if (!codigo) return '';
    return String(codigo).replace(/^0+/, '');
};

const obterIniciais = (nome) => {
  if (!nome) return 'OP';
  const partes = nome.trim().split(/\s+/);
  if (partes.length >= 2) {
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }
  return partes[0].substring(0, 2).toUpperCase();
};

const determinarFilial = (lote) => {
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

const removerZeros = (val) => {
    if (!val) return null;
    const limpo = val.trim().replace(/^0+/, '');
    return limpo === '' ? '0' : limpo;
};

function App() {
  // ESTADOS DE LOGIN E DADOS
  const [crachaLogado, setCrachaLogado] = useState(() => sessionStorage.getItem('usuario_cracha') || '');
  const [nomeLogado, setNomeLogado] = useState(() => sessionStorage.getItem('usuario_nome') || '');
  const [inputCracha, setInputCracha] = useState('');
  const [carregandoLogin, setCarregandoLogin] = useState(false);
  const [isAdmin, setIsAdmin] = useState(() => sessionStorage.getItem('usuario_is_admin') === 'true');
  const [leiturasGlobais, setLeiturasGlobais] = useState([]);
  const [depositosDisponiveis, setDepositosDisponiveis] = useState([]);

  // OFFLINE-FIRST: hook de sincronização automática com IndexedDB
  const { isOnline, pendingCount, syncNow } = useSyncManager();

  
  // ESTADO ROTAS
  const [rotasDisponiveis, setRotasDisponiveis] = useState([]);
  const [rotaAtual, setRotaAtual] = useState(''); 

  // ESTADOS DO FILTRO E PAGINAÇÃO
  const [conferenciaFilters, setConferenciaFilters] = useState({ lote: '', data_leitura: '', filial: '', deposito: '' });
  const [conferenciaSort, setConferenciaSort] = useState({ field: 'Data', order: 'desc' });
  const [paginaAtual, setPaginaAtual] = useState(1);
  const ITENS_POR_PAGINA = 50;

  // ESTADOS DA MÁQUINA DE INVENTÁRIO
  const [etapaInventario, setEtapaInventario] = useState('OCIOSO');
  const [tipoContagem, setTipoContagem] = useState(() => sessionStorage.getItem('tipo_contagem') || null);
  const [modoInventario, setModoInventario] = useState(null);
  const [depositoAtual, setDepositoAtual] = useState('');
  const [gondolaAtual, setGondolaAtual] = useState('');
  const [gavetaAtual, setGavetaAtual] = useState('');

  const [usandoDrone, setUsandoDrone] = useState(false);
  const [codigo, setCodigo] = useState('')
  const [usandoCamera, setUsandoCamera] = useState(false)
  const [carregandoAcao, setCarregandoAcao] = useState(false)
  const [sessaoId, setSessaoId] = useState(() => sessionStorage.getItem('sessao_id') || null);

  const [csvBobinas, setCsvBobinas] = useState(() => {
    const saved = sessionStorage.getItem('csv_bobinas');
    return saved ? JSON.parse(saved) : [];
  })

  const [bobinasLidas, setBobinasLidas] = useState(() => {
    const saved = sessionStorage.getItem('lidas_bobinas');
    return saved ? JSON.parse(saved) : [];
  })

  const [modal, setModal] = useState({
    show: false, title: '', message: '', type: 'alert', onConfirm: null, confirmText: 'Sim', cancelText: 'Cancelar'
  })

  const [showConferencia, setShowConferencia] = useState(false);
  const [lotesExpandidos, setLotesExpandidos] = useState({});

  const inputRef = useRef(null)
  const gondolaInputRef = useRef(null)
  const gavetaInputRef = useRef(null)
  const fileInputRef = useRef(null)

  const toggleLoteExpandido = (loteKey) => {
    setLotesExpandidos(prev => ({ ...prev, [loteKey]: !prev[loteKey] }));
  };

  useEffect(() => {
    const carregarDadosIniciais = async () => {
        try {
            const { data: deps, error: errDeps } = await supabase.from('depositos').select('*').order('id', { ascending: true });
            if (errDeps) throw errDeps;
            if (deps) setDepositosDisponiveis(deps.map(d => ({ id: d.id, nome: d.nome, requerEndereco: d.requer_endereco })));
            
            const { data: rots, error: errRots } = await supabase.from('rotas').select('id, rota');
            if (errRots) throw errRots;
            if (rots) setRotasDisponiveis(rots);
        } catch (err) {
            console.error("Erro ao carregar dados iniciais:", err);
        }
    };
    carregarDadosIniciais();
  }, []);

  useEffect(() => {
    sessionStorage.setItem('csv_bobinas', JSON.stringify(csvBobinas));
    sessionStorage.setItem('lidas_bobinas', JSON.stringify(bobinasLidas));
    if (sessaoId) sessionStorage.setItem('sessao_id', sessaoId);
    else sessionStorage.removeItem('sessao_id');
    if (tipoContagem) sessionStorage.setItem('tipo_contagem', tipoContagem);
    else sessionStorage.removeItem('tipo_contagem');
  }, [csvBobinas, bobinasLidas, sessaoId, tipoContagem]);

  useEffect(() => {
    if (crachaLogado && nomeLogado) {
      sessionStorage.setItem('usuario_cracha', crachaLogado);
      sessionStorage.setItem('usuario_nome', nomeLogado);
      sessionStorage.setItem('usuario_is_admin', String(isAdmin));
    } else {
      sessionStorage.removeItem('usuario_cracha');
      sessionStorage.removeItem('usuario_nome');
      sessionStorage.removeItem('usuario_is_admin');
    }
  }, [crachaLogado, nomeLogado, isAdmin]);

  useEffect(() => {
    if (etapaInventario === 'BIPANDO' && !modal.show && !showConferencia && !usandoCamera) {
      const timer = setTimeout(() => {
        if (inputRef.current) inputRef.current.focus();
      }, 150);
      return () => clearTimeout(timer);
    } else if (etapaInventario === 'INFORMAR_ENDERECO') {
      const timer = setTimeout(() => {
        const depInfo = depositosDisponiveis.find(d => d.id === depositoAtual);
        if (depInfo && depInfo.requerEndereco) {
          if (!gondolaAtual && gondolaInputRef.current) {
            gondolaInputRef.current.focus();
          } else if (gavetaInputRef.current) {
            gavetaInputRef.current.focus();
          }
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [etapaInventario, modal.show, showConferencia, usandoCamera, depositoAtual, gondolaAtual, depositosDisponiveis]);

  useEffect(() => {
    setPaginaAtual(1);
    setLotesExpandidos({});
  }, [conferenciaFilters, conferenciaSort]);

  const fecharModal = () => {
    setModal(prev => ({ ...prev, show: false }));
    setTimeout(() => {
      if (etapaInventario === 'BIPANDO' && inputRef.current) {
        inputRef.current.focus();
      }
    }, 150);
  };
  const abrirAlerta = (titulo, message) => setModal({ show: true, title: titulo, message: message, type: 'alert', onConfirm: null });
  const abrirConfirmacao = (titulo, message, acaoConfirmar, confirmText = 'Sim', cancelText = 'Cancelar', acaoCancelar = null) => {
    setModal({
      show: true, title: titulo, message: message, type: 'confirm', confirmText, cancelText,
      onConfirm: () => { acaoConfirmar(); fecharModal(); },
      onCancel: () => { if (acaoCancelar) acaoCancelar(); fecharModal(); }
    });
  }

  const fazerLogin = async () => {
    if (!inputCracha.trim()) { abrirAlerta('Atenção', 'Insira o número do seu crachá.'); return; }
    setCarregandoLogin(true);
    try {
      const { data, error } = await supabase.from('crachas').select('id, nome_completo, admin').eq('id', inputCracha.trim()).single();
      if (error) { abrirAlerta('Acesso Negado', 'Crachá não encontrado.'); setCarregandoLogin(false); return; }
      if (data) { setCrachaLogado(inputCracha.trim()); setNomeLogado(data.nome_completo || 'Operador'); setIsAdmin(!!data.admin); }
    } catch (err) {
      abrirAlerta('Erro', 'Não foi conectar ao banco Supabase.');
    } finally { setCarregandoLogin(false); }
  }

  const fazerLogout = () => {
    abrirConfirmacao('Sair', 'Deseja sair? Seus dados continuarão na tela.', () => {
      setCrachaLogado(''); setNomeLogado(''); setInputCracha(''); setIsAdmin(false);
    });
  }

  const garantirSessao = async () => {
    if (sessaoId) {
      if (!navigator.onLine) {
        return sessaoId;
      }
      try {
        const { data } = await supabase.from('sessoes_inventario').select('id').eq('id', sessaoId).maybeSingle();
        if (data) return sessaoId;
      } catch (err) {
        console.warn("Falha de rede ao verificar sessao, usando sessaoId local:", err);
        return sessaoId;
      }
    }
    
    if (!navigator.onLine) {
      const idOffline = `offline-${Date.now()}`;
      setSessaoId(idOffline);
      sessionStorage.setItem('sessao_id', idOffline);
      return idOffline;
    }

    const { data, error } = await supabase.from('sessoes_inventario').insert([{ cracha_importacao: crachaLogado, status: 'Em andamento' }]).select('id').single();
    if (error) throw error;
    setSessaoId(data.id);
    return data.id;
  }

  const limparValorParaBanco = (val) => (val === undefined || val === null || String(val).trim() === '') ? null : String(val).trim();
  const limparNumeroParaBanco = (val) => {
    if (val === undefined || val === null || String(val).trim() === '') return null;
    let formatado = String(val).trim();
    if (formatado.includes(',')) formatado = formatado.replace(/\./g, '').replace(',', '.');
    return formatado;
  }

  const formatarEnderecoSAP = (bobina) => {
    if (!bobina) return '-';
    if (bobina.posicao && !bobina.deposito) {
        return `Posição: ${bobina.posicao}`;
    }
    if (bobina.gondola || bobina.posicao) {
      return `Depósito: ${bobina.deposito || '-'} | G: ${bobina.gondola || '-'} | P: ${bobina.posicao || '-'}`;
    }
    const depInfo = depositosDisponiveis.find(d => d.id === bobina.deposito);
    if (depInfo && !depInfo.requerEndereco) {
      return `Depósito: ${bobina.deposito}`;
    }
    return `Depósito: ${bobina.deposito || '-'}`;
  };

  const abrirConferenciaAdmin = async () => {
    setShowConferencia(true);
    setPaginaAtual(1);
    setCarregandoAcao(true);
    try {
      const { data: leituras, error: erroLeituras } = await supabase.from('bobinas_lidas').select('*');
      const { data: crachas } = await supabase.from('crachas').select('id, nome_completo');
      const { data: sapBanco } = await supabase.from('bobinas_sap').select('*');

      if (erroLeituras) throw erroLeituras;

      if (leituras) {
        const listaGlobal = leituras.map(b => {
          const dono = crachas?.find(c => c.id === b.cracha_leitura);
          const dadosSap = sapBanco?.find(s => {
            if (b.romaneio && b.romaneio !== '-') {
              return s.romaneio === b.romaneio;
            }
            return s.lote === b.lote;
          }) || csvBobinas.find(c => {
            if (b.romaneio && b.romaneio !== '-') {
              return c.romaneio === b.romaneio;
            }
            return c.codigo === b.lote;
          });
          const dataOriginal = b.created_at || b.data_hora || b.data_leitura || b.data_registro;
          let dataFormatada = '-';
          if (dataOriginal) {
            const d = new Date(dataOriginal);
            if (!isNaN(d.getTime())) {
              dataFormatada = `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR')}`;
            } else {
              dataFormatada = dataOriginal;
            }
          }
          const filialFinal = b.filial || (dadosSap ? dadosSap.filial : null) || determinarFilial(b.lote) || '-';

          const nomeRota = rotasDisponiveis.find(r => String(r.id) === String(b.rotas))?.rota || b.rotas || '-';

          return {
            codigo: b.lote, dataHora: dataFormatada, cracha: b.cracha_leitura, nome: dono ? dono.nome_completo : b.cracha_leitura,
            lote: b.lote, romaneio: b.romaneio,
            filial: filialFinal, deposito: b.deposito || (dadosSap ? (dadosSap.deposito || '-') : '-'),
            endereco_lido: b.endereco_lido || '-', endereco_sap: formatarEnderecoSAP(dadosSap),
            agrupador: dadosSap ? (dadosSap.agrupador || '-') : '-', material: dadosSap ? (dadosSap.material || '-') : '-',
            descricao: dadosSap ? (dadosSap.descricao || '-') : '-', peso_liquido: dadosSap ? (dadosSap.peso_liquido || '-') : '-',
            largura: dadosSap ? (dadosSap.largura || '-') : '-', espessura: dadosSap ? (dadosSap.espessura || '-') : '-',
            ordem_producao: dadosSap ? (dadosSap.ordem_producao || '-') : '-', ordem_venda: dadosSap ? (dadosSap.ordem_venda || '-') : '-',
            cliente: dadosSap ? (dadosSap.cliente || '-') : '-', nome_cliente: dadosSap ? (dadosSap.nome_cliente || '-') : '-',
            rota: nomeRota
          };
        });
        setLeiturasGlobais(listaGlobal);
      }
    } catch (err) { console.error(err); } finally { setCarregandoAcao(false); }
  };

  const finalizarImportacao = async (linhas, idxCabecalho, separator, headersLimpos, modoEscolhido) => {
    try {
      setCarregandoAcao(true);
      const parseCSVLine = (line) => {
        let result = []; let current = ''; let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          let char = line[i];
          if (char === '"') {
            if (inQuotes && line[i + 1] === '"') { current += '"'; i++; } else { inQuotes = !inQuotes; }
          } else if (char === separator && !inQuotes) { result.push(current); current = ''; } else { current += char; }
        }
        result.push(current); return result.map(val => val.trim());
      };

      const getIdx = (termo) => headersLimpos.indexOf(termo);

      const idxPosicao = getIdx('posicao'); 
      const idxLote = getIdx('lote'); 
      const idxRomaneio = getIdx('romaneio'); 
      const idxMaterial = getIdx('material');
      const idxDescricao = getIdx('descmaterial') !== -1 ? getIdx('descmaterial') : getIdx('descricao'); 
      const idxLargura = getIdx('largura');
      const idxEspessura = getIdx('espessura');
      const idxDeposito = getIdx('deposito');
      const idxCentro = getIdx('centro');
      const idxGondola = getIdx('gondola');
      const idxGaveta = getIdx('gaveta');
      const idxPeso = getIdx('pesoliquido') !== -1 ? getIdx('pesoliquido') : getIdx('peso');
      const idxCliente = getIdx('cliente');
      const idxCidade = getIdx('cidade');
      const idxNomeCliente = getIdx('nomecliente') !== -1 ? getIdx('nomecliente') : getIdx('nome');
      const idxOrdem = getIdx('ordemproducao') !== -1 ? getIdx('ordemproducao') : getIdx('ossige');
      const idxOrdemVenda = getIdx('ordemvenda');
      const idxAgrupador = getIdx('agrupador');

      let codigosExtraidos = [];
      let ultimoRomaneio = null;

      for (let i = idxCabecalho + 1; i < linhas.length; i++) {
        const colunas = parseCSVLine(linhas[i]);
        
        const loteRaw = idxLote !== -1 ? colunas[idxLote] : null;
        const posicaoRaw = idxPosicao !== -1 ? colunas[idxPosicao] : null;
        const romaneioRaw = idxRomaneio !== -1 ? colunas[idxRomaneio] : null;

        const loteLimpo = loteRaw ? loteRaw.trim() : null;
        const posicaoLimpa = posicaoRaw ? posicaoRaw.trim() : null;
        const romaneioLimpo = removerZeros(romaneioRaw);
        const materialLimpo = removerZeros(idxMaterial !== -1 ? colunas[idxMaterial] : null);
        const clienteLimpo = removerZeros(idxCliente !== -1 ? colunas[idxCliente] : null);
        const ordemProducaoLimpa = removerZeros(idxOrdem !== -1 ? colunas[idxOrdem] : null);
        const ordemVendaLimpa = removerZeros(idxOrdemVenda !== -1 ? colunas[idxOrdemVenda] : null);
        const agrupadorLimpo = removerZeros(idxAgrupador !== -1 ? colunas[idxAgrupador] : null);

        if (romaneioLimpo && romaneioLimpo.trim() !== '') {
          ultimoRomaneio = romaneioLimpo.trim();
        }

        let identificadorPrincipal = null;
        if (modoEscolhido === 'ROMANEIO') {
          identificadorPrincipal = romaneioLimpo || ultimoRomaneio;
        } else {
          let identificadorLote = loteLimpo;
          if (!identificadorLote && posicaoLimpa && /(MA|VA|TA|UA|RA|ZA|FA|UV)\d+/i.test(posicaoLimpa)) {
              identificadorLote = posicaoLimpa.match(/(MA|VA|TA|UA|RA|ZA|FA|UV)\d+/i)[0].toUpperCase();
          } else if (!identificadorLote && (!romaneioRaw || romaneioRaw.trim() === '') && posicaoLimpa && posicaoLimpa !== '') {
              identificadorLote = posicaoLimpa;
          }
          identificadorPrincipal = identificadorLote ? identificadorLote.trim() : null;
        }

        if (identificadorPrincipal) {
          let filialLida = idxCentro !== -1 ? colunas[idxCentro] : null;
          if (!filialLida || filialLida.trim() === '') filialLida = determinarFilial(identificadorPrincipal);

          codigosExtraidos.push({
            codigo: limparCodigo(identificadorPrincipal),
            lote: (modoEscolhido === 'LOTE') ? (loteLimpo ? limparCodigo(loteLimpo) : limparCodigo(identificadorPrincipal)) : null,
            romaneio: (modoEscolhido === 'ROMANEIO') ? (romaneioLimpo ? limparCodigo(romaneioLimpo) : limparCodigo(identificadorPrincipal)) : null,
            material: materialLimpo,
            cliente: clienteLimpo,
            nome_cliente: (idxNomeCliente !== -1 ? colunas[idxNomeCliente] : (idxCidade !== -1 ? colunas[idxCidade] : null)),
            peso_liquido: idxPeso !== -1 ? colunas[idxPeso] : null,
            descricao: idxDescricao !== -1 ? colunas[idxDescricao] : null,
            ordem_producao: ordemProducaoLimpa,
            ordem_venda: ordemVendaLimpa,
            agrupador: agrupadorLimpo,
            largura: idxLargura !== -1 ? colunas[idxLargura] : null,
            espessura: idxEspessura !== -1 ? colunas[idxEspessura] : null,
            deposito: idxDeposito !== -1 ? colunas[idxDeposito] : null,
            gondola: idxGondola !== -1 ? colunas[idxGondola] : null,
            posicao: idxGaveta !== -1 ? colunas[idxGaveta] : posicaoLimpa,
            filial: filialLida
          });
        }
      }

      const idSessaoAtiva = await garantirSessao();
      
      const dadosParaBanco = codigosExtraidos.map(item => ({
        sessao_id: idSessaoAtiva, 
        lote: item.lote || item.codigo, 
        romaneio: item.romaneio, 
        material: limparValorParaBanco(item.material), 
        cliente: limparValorParaBanco(item.cliente), 
        nome_cliente: limparValorParaBanco(item.nome_cliente), 
        peso_liquido: limparNumeroParaBanco(item.peso_liquido), 
        descricao: limparValorParaBanco(item.descricao), 
        posicao: limparValorParaBanco(item.posicao),
        ordem_producao: limparValorParaBanco(item.ordem_producao),
        ordem_venda: limparValorParaBanco(item.ordem_venda),
        agrupador: limparValorParaBanco(item.agrupador),
        largura: limparNumeroParaBanco(item.largura),
        espessura: limparNumeroParaBanco(item.espessura),
        deposito: limparValorParaBanco(item.deposito),
        gondola: limparValorParaBanco(item.gondola),
        filial: limparValorParaBanco(item.filial),
        rota: rotaAtual || null 
      }));

      const { error: erroSap } = await supabase.from('bobinas_sap').insert(dadosParaBanco);
      if (erroSap) console.warn("Aviso ao salvar base SAP:", erroSap);

      setCsvBobinas(codigosExtraidos);
      abrirAlerta('Sucesso', `Planilha importada! (${codigosExtraidos.length} itens processados como ${modoEscolhido === 'ROMANEIO' ? 'Romaneio' : 'Lote'})`);

    } catch (erro) {
      console.error(erro); abrirAlerta('Erro no Arquivo', erro.message || "Falha ao processar o CSV.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setCarregandoAcao(false);
    }
  };

  const importarCSV = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setCarregandoAcao(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target.result;
        const linhas = text.split(/\r?\n/).filter(linha => linha.trim() !== '');
        if (linhas.length === 0) { setCarregandoAcao(false); return; }

        let idxCabecalho = 0;
        for (let i = 0; i < Math.min(10, linhas.length); i++) {
          if (linhas[i].toLowerCase().includes('posição') || linhas[i].toLowerCase().includes('posicao') || linhas[i].toLowerCase().includes('romaneio') || linhas[i].toLowerCase().includes('lote')) { 
            idxCabecalho = i; 
            break; 
          }
        }

        const linhaCabecalho = linhas[idxCabecalho];
        let separator = ';';
        const numSemicolons = (linhaCabecalho.match(/;/g) || []).length;
        const numCommas = (linhaCabecalho.match(/,/g) || []).length;
        const numTabs = (linhaCabecalho.match(/\t/g) || []).length;

        if (numTabs > numSemicolons && numTabs > numCommas) {
          separator = '\t';
        } else if (numSemicolons >= numCommas) {
          separator = ';';
        } else {
          separator = ',';
        }

        const parseCSVLine = (line) => {
          let result = []; let current = ''; let inQuotes = false;
          for (let i = 0; i < line.length; i++) {
            let char = line[i];
            if (char === '"') {
              if (inQuotes && line[i + 1] === '"') { current += '"'; i++; } else { inQuotes = !inQuotes; }
            } else if (char === separator && !inQuotes) { result.push(current); current = ''; } else { current += char; }
          }
          result.push(current); return result.map(val => val.trim());
        };

        const headersLimpos = parseCSVLine(linhaCabecalho).map(h => h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""));
        const getIdx = (termo) => headersLimpos.indexOf(termo);

        const idxPosicao = getIdx('posicao'); 
        const idxLote = getIdx('lote'); 
        const idxRomaneio = getIdx('romaneio'); 

        if (idxPosicao === -1 && idxRomaneio === -1 && idxLote === -1) { 
          abrirAlerta('Erro', 'A planilha não possui as colunas esperadas ("Lote", "Posição" ou "Romaneio").'); 
          setCarregandoAcao(false); 
          return; 
        }

        const temLoteOuPosicao = idxLote !== -1 || idxPosicao !== -1;
        const temRomaneio = idxRomaneio !== -1;

        if (temLoteOuPosicao && temRomaneio) {
          setCarregandoAcao(false);
          abrirConfirmacao(
            'Importar Planilha',
            'Esta planilha possui colunas de Lote/Posição e Romaneio. Como deseja realizar a importação?',
            () => finalizarImportacao(linhas, idxCabecalho, separator, headersLimpos, 'LOTE'),
            'Apenas Lotes / Agrupadores',
            'Apenas Romaneios',
            () => finalizarImportacao(linhas, idxCabecalho, separator, headersLimpos, 'ROMANEIO'),
            () => { if (fileInputRef.current) fileInputRef.current.value = ''; }
          );
        } else if (temRomaneio) {
          await finalizarImportacao(linhas, idxCabecalho, separator, headersLimpos, 'ROMANEIO');
        } else {
          await finalizarImportacao(linhas, idxCabecalho, separator, headersLimpos, 'LOTE');
        }

      } catch (erro) {
        console.error(erro); abrirAlerta('Erro no Arquivo', erro.message || "Falha ao processar o CSV.");
        setCarregandoAcao(false);
      }
    };
    reader.readAsText(file, 'ISO-8859-1');
  };

  const processarEntradaMassa = (textoEntrada) => {
    let itensExtraidos = [];
    if (!textoEntrada) return itensExtraidos;

    const linhas = textoEntrada.split(/[\r\n]+/);

    for (let linha of linhas) {
      linha = linha.trim().toUpperCase();
      if (!linha) continue;

      // Se a contagem ativa for LOTE:
      if (tipoContagem === 'LOTE') {
        // 1. Se a linha contiver a tag de lotes VL\d+LT (canto inferior direito)
        const matchVL = linha.match(/VL\d+LT/i);
        if (matchVL) {
          const indexFimTag = matchVL.index + matchVL[0].length;
          const restante = linha.substring(indexFimTag);
          
          // Quebra os lotes pelo espaço ou outros delimitadores comuns
          const partesInternas = restante.split(/[\s;]+/);
          partesInternas.forEach(p => {
            let palavraLote = p.trim();
            if (!palavraLote) return;

            // Se a palavra contiver a palavra 'KG' (ex: VA13131815KG126,84), pega apenas o que vem antes de 'KG'
            if (/KG/i.test(palavraLote)) {
              const partesKG = palavraLote.split(/KG/i);
              palavraLote = partesKG[0].trim();
            }

            const limpo = removerZeros(palavraLote);
            // Lote físico sempre começa com letra e tem comprimento de lote típico (6 a 12 caracteres)
            if (limpo && /^[A-Z]/i.test(limpo.charAt(0)) && limpo.length >= 6 && limpo.length <= 12) {
              itensExtraidos.push({ tipo: 'lote', valor: limpo });
            }
          });
          continue;
        }

        // 2. Se a linha NÃO contiver a tag VL\d+LT
        const palavras = linha.split(/[\s,;\-\/]+/).filter(Boolean);
        
        // Se tiver múltiplos termos sem a tag VL\d+LT (ex: cabeçalho MA1003OP500895600), ignoramos inteiramente
        if (palavras.length > 1) {
          continue;
        }

        if (palavras.length === 1) {
          const termoUnico = palavras[0];
          // Descarta se contiver OP (Ordem de Produção) ou se for muito longo para ser lote (ex: cabeçalhos colados)
          if (termoUnico.includes('OP') || termoUnico.length > 12) {
            continue;
          }

          const valorLimpo = removerZeros(termoUnico);
          if (!valorLimpo) continue;

          const isPrefixoAG = termoUnico.startsWith('AG');
          const agNumeroLimpo = isPrefixoAG ? removerZeros(termoUnico.substring(2)) : valorLimpo;

          // Se for um identificador de agrupador e o SAP estiver carregado, expande seus lotes
          const itemSAPAgr = csvBobinas.find(c => removerZeros(c.agrupador) === agNumeroLimpo);

          if (itemSAPAgr) {
            const bobinasDoAgrupador = csvBobinas.filter(c => removerZeros(c.agrupador) === agNumeroLimpo);
            bobinasDoAgrupador.forEach(b => {
              if (b.lote) {
                itensExtraidos.push({ tipo: 'lote', valor: b.lote });
              }
            });
          } else {
            // Se não estiver no SAP ou for Sobra, aceita apenas se começar com LETRA e não for o termo com prefixo AG puro
            const comecaComLetra = /^[A-Z]/i.test(valorLimpo.charAt(0));
            if (comecaComLetra && !isPrefixoAG) {
              itensExtraidos.push({ tipo: 'lote', valor: valorLimpo });
            }
          }
        }
      }

      // Se a contagem ativa for ROMANEIO:
      if (tipoContagem === 'ROMANEIO') {
        // Se contiver a tag de lotes VL\d+LT (o agrupador do canto inferior), ignoramos por completo no Romaneio
        if (/VL\d+LT/i.test(linha)) {
          continue;
        }

        // 1. Se contiver a tag (7) e (8) ou apenas a tag (7) com dígitos subsequentes
        if (linha.includes('(7)')) {
          const regexRom = /\(7\)(\d+)/i;
          const matchRom = regexRom.exec(linha);
          if (matchRom) {
            const valorRom = matchRom[1].trim();
            const limpo = removerZeros(valorRom);
            if (limpo && /^\d+$/.test(limpo)) {
              itensExtraidos.push({ tipo: 'romaneio', valor: limpo });
            }
          }
          continue;
        }

        // 2. Se for um termo único inteiramente numérico (ex: romaneio digitado diretamente ou bipado)
        const palavras = linha.split(/[\s,;\-\/]+/).filter(Boolean);
        if (palavras.length === 1) {
          const termoUnico = palavras[0];
          const valorLimpo = removerZeros(termoUnico);
          if (valorLimpo && /^\d+$/.test(valorLimpo) && valorLimpo.length >= 6 && valorLimpo.length <= 12) {
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

  const adicionarBobina = async (codigoCopia = null) => {
    const textoLido = (typeof codigoCopia === 'string' ? codigoCopia : codigo).trim();
    if (!textoLido) return;

    const itensExtraidos = processarEntradaMassa(textoLido);

    if (itensExtraidos.length === 0) {
      abrirAlerta('Atenção', `Nenhum código de ${tipoContagem === 'LOTE' ? 'Lote físico' : 'Romaneio'} válido foi reconhecido nesta leitura.`);
      setCodigo(''); return;
    }

    const itensValidos = [];
    const itensRejeitados = [];

    for (const item of itensExtraidos) {
      if (tipoContagem === 'LOTE' && item.tipo !== 'lote') {
        itensRejeitados.push(item.valor);
      } else if (tipoContagem === 'ROMANEIO' && item.tipo !== 'romaneio') {
        itensRejeitados.push(item.valor);
      } else {
        itensValidos.push(item);
      }
    }

    if (itensRejeitados.length > 0 && itensValidos.length === 0) {
      abrirAlerta(
        'Leitura Rejeitada', 
        `Este inventário está configurado para contagem de ${tipoContagem === 'LOTE' ? 'Lotes' : 'Romaneios'}.\n\nCódigo(s) rejeitado(s) por incompatibilidade:\n${itensRejeitados.join(', ')}`
      );
      setCodigo('');
      return;
    }

    if (itensRejeitados.length > 0) {
      abrirAlerta(
        'Aviso de Compatibilidade', 
        `Alguns códigos foram descartados por não serem ${tipoContagem === 'LOTE' ? 'Lotes' : 'Romaneios'}:\n${itensRejeitados.join(', ')}`
      );
    }

    setCarregandoAcao(true);

    try {
      const idSessaoAtiva = await garantirSessao();
      let listaAtualizada = [...bobinasLidas];
      let itensProcessadosMsg = [];
      let avisos = [];
      let insercoesNoBanco = [];

      for (const item of itensValidos) {
        const codigoLimpo = limparCodigo(item.valor);
        if (!codigoLimpo) continue;

        const bobinaSAP = csvBobinas.find(c => {
          if (tipoContagem === 'ROMANEIO') {
            return limparCodigo(c.romaneio) === codigoLimpo;
          } else {
            return limparCodigo(c.codigo) === codigoLimpo;
          }
        });

        // Se for Romaneio e a planilha SAP estiver carregada, rejeita códigos estranhos que não pertencem a ela
        if (tipoContagem === 'ROMANEIO' && csvBobinas.length > 0 && !bobinaSAP) {
            avisos.push(`❌ O Romaneio ${codigoLimpo} não pertence a esta planilha SAP.`);
            continue;
        }

        const identificadorFinal = bobinaSAP ? bobinaSAP.codigo : codigoLimpo;

        if (listaAtualizada.some(b => b.codigo === identificadorFinal)) {
            avisos.push(`⚠️ O item ${identificadorFinal} já foi lido.`); continue;
        }

        const filialMapeada = determinarFilial(identificadorFinal) || (bobinaSAP ? bobinaSAP.filial : null);
        const depositoAInserir = modoInventario === 'COM_ENDERECO' ? depositoAtual : (bobinaSAP ? bobinaSAP.deposito : null);

        let enderecoAInserir = null;
        if (modoInventario === 'COM_ENDERECO') {
          const depInfo = depositosDisponiveis.find(d => d.id === depositoAtual);
          if (depInfo && depInfo.requerEndereco) { 
            enderecoAInserir = `Depósito: ${depositoAtual}${gondolaAtual.trim() ? ` | G: ${gondolaAtual}` : ''} | P: ${gavetaAtual}`; 
          } else { 
            enderecoAInserir = `Depósito: ${depositoAtual}`; 
          }
        }

        insercoesNoBanco.push({
          sessao_id: idSessaoAtiva, 
          lote: identificadorFinal, 
          romaneio: bobinaSAP ? bobinaSAP.romaneio : (tipoContagem === 'ROMANEIO' ? codigoLimpo : null), 
          cracha_leitura: crachaLogado,
          filial: filialMapeada, 
          deposito: depositoAInserir, 
          endereco_lido: enderecoAInserir, 
          rotas: rotaAtual || null
        });

        if (bobinaSAP) {
            itensProcessadosMsg.push(`Registrado: ${identificadorFinal}`);
        } else {
            avisos.push(`⚠️ Adicionado ${identificadorFinal}, mas não consta na planilha SAP.`);
        }

        listaAtualizada = [{
          codigo: identificadorFinal, 
          lote: identificadorFinal, 
          romaneio: bobinaSAP ? bobinaSAP.romaneio : (tipoContagem === 'ROMANEIO' ? codigoLimpo : null), 
          dataHora: `${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}`, 
          cracha: crachaLogado,
          nome: nomeLogado, 
          filial: filialMapeada, 
          deposito: depositoAInserir, 
          endereco_lido: enderecoAInserir, 
          rota: rotaAtual
        }, ...listaAtualizada];
      }

      if (insercoesNoBanco.length > 0) {
          // OFFLINE-FIRST: salva localmente primeiro (nunca falha), depois tenta sincronizar
          const agora = Date.now();
          await db.leituras_pendentes.bulkAdd(
            insercoesNoBanco.map(i => ({ ...i, _status: 'pendente', _criado_em: agora }))
          );
          setBobinasLidas(listaAtualizada);
          // Tenta sincronizar em background (não bloqueia nem exibe erro se offline)
          syncNow();
      }
      
      setCodigo('');
      setUsandoCamera(false);

      if (itensProcessadosMsg.length > 0 && avisos.length === 0) {
        abrirAlerta('✅ Processamento OK!', `${itensProcessadosMsg.join('\n')}`);
      } else if (avisos.length > 0 || itensProcessadosMsg.length > 0) {
        const sucessoTxt = itensProcessadosMsg.length > 0 ? `Lidos:\n${itensProcessadosMsg.join('\n')}\n\n` : '';
        const alertaText = avisos.length > 5 ? `${avisos.slice(0, 5).join('\n')}\n...e mais ${avisos.length - 5} avisos.` : avisos.join('\n');
        abrirAlerta('Resumo da Leitura', sucessoTxt + alertaText);
      }
    } catch (erro) {
      console.error(erro); abrirAlerta('Erro', 'Falha ao salvar a leitura no banco de dados.');
    } finally { setCarregandoAcao(false); }
  }

  const processarLoteDrone = async (arrayDeTextosLidos) => {
    setUsandoDrone(false);
    if (arrayDeTextosLidos.length === 0) { abrirAlerta('Resultado', 'Nenhum código lido.'); return; }

    setCarregandoAcao(true);
    let lotesFormatados = [];

    arrayDeTextosLidos.forEach(texto => {
      const matches = processarEntradaMassa(texto);
      const matchesValidos = matches.filter(m => {
        if (tipoContagem === 'LOTE' && m.tipo !== 'lote') return false;
        if (tipoContagem === 'ROMANEIO' && m.tipo !== 'romaneio') return false;
        
        // Se for Romaneio e a planilha estiver carregada, o código precisa constar nela
        if (tipoContagem === 'ROMANEIO' && csvBobinas.length > 0) {
          const existeNoSap = csvBobinas.some(c => limparCodigo(c.romaneio) === m.valor);
          if (!existeNoSap) return false;
        }
        return true;
      });
      if (matchesValidos.length > 0) lotesFormatados.push(...matchesValidos.map(m => m.valor));
    });

    lotesFormatados = [...new Set(lotesFormatados)];
    if (lotesFormatados.length === 0) { 
      setCarregandoAcao(false); 
      abrirAlerta('Atenção', `Nenhum código de ${tipoContagem === 'LOTE' ? 'Lote físico' : 'Romaneio'} válido foi capturado pelo drone.`); 
      return; 
    }

    try {
      const idSessaoAtiva = await garantirSessao();
      let listaAtualizada = [...bobinasLidas];
      let insercoesNoBanco = [];

      let enderecoAInserir = null;
      if (modoInventario === 'COM_ENDERECO') {
        const depInfo = depositosDisponiveis.find(d => d.id === depositoAtual);
        if (depInfo && depInfo.requerEndereco) {
          enderecoAInserir = `Depósito: ${depositoAtual} | G: ${gondolaAtual} | P: ${gavetaAtual}`;
        } else {
          enderecoAInserir = `Depósito: ${depositoAtual}`;
        }
      }

      for (const lote of lotesFormatados) {
        if (!lote) continue;
        
        const bobinaSAP = csvBobinas.find(c => {
          if (tipoContagem === 'ROMANEIO') {
            return c.romaneio === lote;
          } else {
            return c.codigo === lote;
          }
        });
        const identificadorFinal = bobinaSAP ? bobinaSAP.codigo : lote;

        if (listaAtualizada.some(b => b.codigo === identificadorFinal)) continue;
        
        const filialMapeada = determinarFilial(identificadorFinal) || (bobinaSAP ? bobinaSAP.filial : null);
        const depositoAInserir = modoInventario === 'COM_ENDERECO' ? depositoAtual : (bobinaSAP ? bobinaSAP.deposito : null);

        listaAtualizada = [{
          codigo: identificadorFinal, 
          lote: identificadorFinal,
          romaneio: bobinaSAP ? bobinaSAP.romaneio : (tipoContagem === 'ROMANEIO' ? lote : null),
          dataHora: `${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}`, cracha: crachaLogado, nome: nomeLogado,
          filial: filialMapeada, deposito: depositoAInserir, endereco_lido: enderecoAInserir, rota: rotaAtual
        }, ...listaAtualizada];

        insercoesNoBanco.push({
          sessao_id: idSessaoAtiva, 
          lote: identificadorFinal, 
          romaneio: bobinaSAP ? bobinaSAP.romaneio : (tipoContagem === 'ROMANEIO' ? lote : null),
          cracha_leitura: crachaLogado,
          filial: filialMapeada, deposito: depositoAInserir, endereco_lido: enderecoAInserir, rotas: rotaAtual || null
        });
      }

      if (insercoesNoBanco.length > 0) {
        // OFFLINE-FIRST: salva localmente primeiro, sincroniza em background
        const agora = Date.now();
        await db.leituras_pendentes.bulkAdd(
          insercoesNoBanco.map(i => ({ ...i, _status: 'pendente', _criado_em: agora }))
        );
        syncNow();
      }
      setBobinasLidas(listaAtualizada);
      abrirAlerta('Missão do Drone Concluída!', `Processados e inseridos ${insercoesNoBanco.length} novos itens.`);
    } catch (erro) { abrirAlerta('Erro', 'Ocorreu um problema ao salvar os dados do drone.'); } finally { setCarregandoAcao(false); }
  };

  const removerBobina = async (codigoParaRemover) => {
    setCarregandoAcao(true);
    try {
      // Remove do Supabase (online) e do IndexedDB local (pendentes que ainda não foram enviadas)
      if (sessaoId && navigator.onLine) {
        await supabase.from('bobinas_lidas').delete().eq('sessao_id', sessaoId).eq('lote', codigoParaRemover);
      }
      await db.leituras_pendentes
        .where('lote').equals(codigoParaRemover)
        .and(item => item.sessao_id === sessaoId)
        .delete();
      setBobinasLidas(bobinasLidas.filter(b => b.codigo !== codigoParaRemover));
    } catch (erro) { abrirAlerta('Erro', 'Falha ao excluir.'); } finally { setCarregandoAcao(false); }
  }

  const limparDados = () => {
    abrirConfirmacao('Limpar Tela', 'Deseja limpar os dados da tela e iniciar uma nova contagem?', () => {
      setBobinasLidas([]); setCsvBobinas([]); setSessaoId(null); setEtapaInventario('OCIOSO'); setModoInventario(null);
      setDepositoAtual(''); setGondolaAtual(''); setGavetaAtual(''); setTipoContagem(null);
    });
  }

  const avancarParaInformarEndereco = () => {
    if (!depositoAtual) { abrirAlerta('Atenção', 'Por favor, selecione um Depósito.'); return; }
    const depInfo = depositosDisponiveis.find(d => d.id === depositoAtual);
    if (depInfo && depInfo.requerEndereco) {
      if (!gavetaAtual.trim()) { abrirAlerta('Atenção', 'Para este depósito, é obrigatório preencher a Gaveta/Posição.'); return; }
    }
    setEtapaInventario('BIPANDO');
  };

  const finalizarGaveta = () => {
    const depInfo = depositosDisponiveis.find(d => d.id === depositoAtual);

    if (depInfo && depInfo.requerEndereco) {
      abrirConfirmacao('Gaveta Finalizada', `Deseja ir para a próxima gaveta (mantendo Rota, Depósito e Gôndola) ou finalizar?`, () => {
        setGavetaAtual(''); setEtapaInventario('INFORMAR_ENDERECO');
      }, 'Próxima Gaveta', 'Encerrar Tudo');
    } else {
      abrirConfirmacao('Depósito Finalizado', `Deseja inventariar outro depósito ou finalizar?`, () => {
        setDepositoAtual(''); setGondolaAtual(''); setGavetaAtual(''); setEtapaInventario('INFORMAR_ENDERECO');
      }, 'Outro Depósito', 'Encerrar Tudo');
    }

    setModal(prev => ({ ...prev, onCancel: () => { setEtapaInventario('OCIOSO'); setModoInventario(null); setDepositoAtual(''); setGondolaAtual(''); setGavetaAtual(''); setTipoContagem(null); fecharModal(); } }));
  };

  const encerrarInventarioLivre = () => {
    abrirConfirmacao('Encerrar', 'Deseja parar de bipar e voltar ao início?', () => { setEtapaInventario('OCIOSO'); setModoInventario(null); setDepositoAtual(''); setTipoContagem(null); });
  };

  // AUDITORIA E RELATÓRIO COM VALIDAÇÃO INTELIGENTE
  const obterRelatorioConciliado = () => {
    const lidasCodes = bobinasLidas.map(b => b.codigo);
    let relatorio = [];

    bobinasLidas.forEach(b => {
      const bobinaSAP = csvBobinas.find(c => {
        if (b.romaneio && b.romaneio !== '-') {
          return c.romaneio === b.romaneio;
        }
        return c.codigo === b.codigo;
      });
      const isOk = !!bobinaSAP;
      const filialFinal = b.filial || (bobinaSAP ? bobinaSAP.filial : null) || determinarFilial(b.codigo) || '-';

      const endereco_sap_formatado = formatarEnderecoSAP(bobinaSAP);
      const endereco_lido = b.endereco_lido || '-';

      // Pega o nome da Rota que o operador escolheu
      const idRotaSalvo = b.rotas || b.rota;
      const nomeRota = rotasDisponiveis.find(r => String(r.id) === String(idRotaSalvo))?.rota || idRotaSalvo || '-';

      let statusFinal = ''; let tipoFinal = '';
      if (csvBobinas.length === 0) { statusFinal = 'Bipada (Sem SAP base)'; tipoFinal = 'sobrando'; }
      else if (!isOk) { statusFinal = 'Sobrando (Não SAP)'; tipoFinal = 'sobrando'; }
      else {
        
        // VALIDAÇÃO 1: Checa se é exatamente igual (Padrão)
        let enderecoCorreto = (endereco_lido === endereco_sap_formatado);

        // VALIDAÇÃO 2: Inteligência Cruzando [Rota]-[Gaveta] com a posição SAP
        if (!enderecoCorreto && endereco_lido !== '-' && endereco_sap_formatado !== '-') {
            // Extrai a gaveta da string. Ex: "Depósito: 9000 | G: A | P: 04C" -> pega o "04C"
            const matchGaveta = endereco_lido.match(/\|\s*P:\s*([^|]+)/);
            
            if (matchGaveta && nomeRota !== '-') {
                const gavetaExtraida = matchGaveta[1].trim();
                
                // Constrói a posição simulando como o SAP faz: "Posição: R04D-04C"
                const posicaoCombinada = `Posição: ${nomeRota}-${gavetaExtraida}`;
                
                if (posicaoCombinada === endereco_sap_formatado) {
                    enderecoCorreto = true;
                }
            }
        }

        if (endereco_lido !== '-' && endereco_sap_formatado !== '-' && !enderecoCorreto) {
          statusFinal = 'Local Incorreto'; tipoFinal = 'divergencia';
        } else { 
          statusFinal = 'OK (Lida)'; tipoFinal = 'ok'; 
        }
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
      if (!lidasCodes.includes(c.codigo)) {
        const filialFinal = c.filial || determinarFilial(c.codigo) || '-';
        const endereco_sap_formatado = formatarEnderecoSAP(c);
        relatorio.push({
          codigo: c.codigo, status: 'Faltando (Não Bipada)', dataHora: '-', cracha: '-', nome_operador: '-', filial: filialFinal,
          lote: c.lote || c.codigo, romaneio: c.romaneio || '-',
          deposito: c.deposito || '-', agrupador: c.agrupador || '-', endereco_lido: '-', endereco_sap: endereco_sap_formatado,
          material: c.material || '-', descricao: c.descricao || '-', peso_liquido: c.peso_liquido || '-', largura: c.largura || '-',
          espessura: c.espessura || '-', ordem_producao: c.ordem_producao || '-', ordem_venda: c.ordem_venda || '-',
          cliente: c.cliente || '-', nome_cliente: c.nome_cliente || '-', 
          rota: '-', 
          tipo: 'faltando'
        });
      }
    });
    return relatorio;
  }

  const gerarRelatorio = () => {
    const dados = obterRelatorioConciliado();
    if (dados.length === 0) { abrirAlerta('Vazio', 'Sem dados para gerar relatório.'); return; }
    const limparParaCSV = (val) => {
      if (val === '-' || !val) return '-'; let str = String(val); if (str.includes(';') || str.includes(',')) return `"${str}"`; return str;
    };
    
    let csvContent = "data:text/csv;charset=utf-8,\uFEFFLote/Posicao;Romaneio;Material;Descricao;Filial;Deposito;Endereco Lido;Endereco SAP;Peso Liquido;Status;Rota;Data e Hora Leitura;Operador;Cracha\n"
      + dados.map(e => `${limparParaCSV(e.lote)};${limparParaCSV(e.romaneio)};${limparParaCSV(e.material)};${limparParaCSV(e.descricao)};${limparParaCSV(e.filial)};${limparParaCSV(e.deposito)};${limparParaCSV(e.endereco_lido)};${limparParaCSV(e.endereco_sap)};${limparParaCSV(e.peso_liquido)};${limparParaCSV(e.status)};${limparParaCSV(e.rota)};${limparParaCSV(e.dataHora)};${limparParaCSV(e.nome_operador)};${limparParaCSV(e.cracha)}`).join("\n");
    
    const link = document.createElement("a"); link.href = encodeURI(csvContent); link.download = `relatorio_inventario_${new Date().getTime()}.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  }

  const relatorioNaTela = obterRelatorioConciliado();
  const qtdLidas = bobinasLidas.length; const qtdEsperadas = csvBobinas.length;
  const qtdFaltam = Math.max(0, qtdEsperadas - bobinasLidas.filter(b => csvBobinas.some(c => c.codigo === b.codigo)).length);

  const leiturasProcessadas = leiturasGlobais.filter(l => {
    if (conferenciaFilters.lote && !l.codigo.includes(conferenciaFilters.lote) && (!l.romaneio || !l.romaneio.includes(conferenciaFilters.lote))) return false;
    if (conferenciaFilters.filial && l.filial !== conferenciaFilters.filial) return false;
    if (conferenciaFilters.deposito && l.deposito !== conferenciaFilters.deposito) return false;
    return true;
  }).sort((a, b) => {
    const parseData = (str) => {
      if (!str || str === '-') return 0;
      const match = str.match(/(\d{2})\/(\d{2})\/(\d{4})[,\s]*(\d{2}):(\d{2}):(\d{2})/);
      if (match) return new Date(`${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:${match[6]}`).getTime();
      return 0;
    };
    if (conferenciaSort.field === 'Data') {
       return conferenciaSort.order === 'asc' ? parseData(a.dataHora) - parseData(b.dataHora) : parseData(b.dataHora) - parseData(a.dataHora);
    }
    return 0;
  });

  const totalPaginas = Math.ceil(leiturasProcessadas.length / ITENS_POR_PAGINA) || 1;
  const paginaCorrigida = Math.min(paginaAtual, totalPaginas);
  const leiturasPaginadas = leiturasProcessadas.slice((paginaCorrigida - 1) * ITENS_POR_PAGINA, paginaCorrigida * ITENS_POR_PAGINA);

  // IDENTIFICA A ROTA ATUAL PARA EXIBIÇÃO NO CABEÇALHO DE LEITURA ATIVA
  const nomeRotaAtiva = rotasDisponiveis.find(r => String(r.id) === String(rotaAtual))?.rota;

    if (!crachaLogado) {
    return (
      <div className="min-vh-100 d-flex justify-content-center align-items-center position-relative px-3 py-4" style={{ backgroundColor: '#f4f6f8' }}>

        {modal.show && (
          <div className="modal fade show d-block vp-modal-overlay" tabIndex="-1" style={{ zIndex: 1050 }}>
            <div className="modal-dialog modal-dialog-centered mx-3 mx-sm-auto">
              <div className="modal-content shadow-lg border-0" style={{ borderRadius: '16px', overflow: 'hidden' }}>
                <div className={`modal-header border-0 ${modal.type === 'confirm' ? 'bg-danger text-white' : 'bg-dark text-white'}`}>
                  <h5 className="modal-title fw-bold fs-6">Aviso</h5>
                  <button type="button" className="btn-close btn-close-white" onClick={fecharModal}></button>
                </div>
                <div className="modal-body p-4 fs-6 text-secondary text-center">
                  <p className="mb-0">{modal.message}</p>
                </div>
                <div className="modal-footer border-0 justify-content-center pb-4">
                  <button type="button" className="vp-btn vp-btn-dark w-100 w-sm-auto" onClick={fecharModal}>Fechar</button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="card w-100 shadow-lg border-0 animate__animated animate__fadeInUp animate__faster"
          style={{
            maxWidth: '400px',
            borderRadius: '16px',
            overflow: 'hidden'
          }}>

          <div style={{ height: '6px', width: '100%', backgroundColor: 'var(--vp-primary)' }}></div>

          <div className="card-body p-4 p-sm-5 pt-4">

            <div className="text-center mb-4 pb-2">
              <img
                src={logoVideplast}
                alt="Videplast"
                className="img-fluid mb-4"
                style={{ maxHeight: '55px', objectFit: 'contain' }}
              />
              <h4 className="fw-bold mb-2" style={{ color: '#1e293b', fontSize: '1.25rem' }}>
                Acesso ao Sistema
              </h4>
              <div className="mt-3">
                <span className="badge bg-light text-secondary border px-3 py-2 rounded-pill fw-semibold shadow-sm" style={{ letterSpacing: '0.3px', fontSize: '0.8rem' }}>
                  <i className="bi bi-box-seam me-1 text-danger"></i> Controle de Estoque
                </span>
              </div>
            </div>

            <div className="mb-4 text-start">
              <label className="form-label fw-bold small mb-2 text-muted text-uppercase" style={{ letterSpacing: '0.5px', fontSize: '0.75rem' }}>
                Credencial do Operador
              </label>

              <div
                className="d-flex align-items-center w-100 bg-white shadow-sm"
                style={{
                  borderRadius: '10px',
                  height: '54px',
                  border: '1px solid #ced4da',
                  transition: 'border-color 0.2s ease',
                  overflow: 'hidden'
                }}
              >
                <div className="d-flex justify-content-center align-items-center text-secondary" style={{ width: '48px', height: '100%' }}>
                  <i className="bi bi-person-badge fs-5"></i>
                </div>
                <input
                  type="number"
                  className="w-100 h-100 border-0"
                  placeholder="Nº do Crachá"
                  value={inputCracha}
                  onChange={e => setInputCracha(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !carregandoLogin && inputCracha.trim() !== '' && fazerLogin()}
                  autoFocus
                  disabled={carregandoLogin}
                  style={{
                    fontSize: '1.05rem',
                    fontWeight: '600',
                    letterSpacing: '1px',
                    paddingLeft: '0',
                    backgroundColor: 'transparent',
                    outline: 'none',
                    boxShadow: 'none'
                  }}
                  onFocus={(e) => e.target.parentElement.style.borderColor = 'var(--vp-primary)'}
                  onBlur={(e) => e.target.parentElement.style.borderColor = '#ced4da'}
                />
              </div>
            </div>
            <button
              className="btn w-100 shadow-sm d-flex justify-content-center align-items-center gap-2"
              onClick={fazerLogin}
              disabled={carregandoLogin || inputCracha.trim() === ''}
              style={{
                backgroundColor: 'var(--vp-primary)',
                color: 'white',
                height: '54px',
                borderRadius: '10px',
                fontSize: '1rem',
                fontWeight: '700',
                border: 'none',
                transition: 'transform 0.2s ease',
                cursor: (carregandoLogin || inputCracha.trim() === '') ? 'not-allowed' : 'pointer'
              }}
            >
              {carregandoLogin ? (
                <><span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Autenticando...</>
              ) : (
                <>Entrar na Sessão <i className="bi bi-arrow-right-short fs-4"></i></>
              )}
            </button>
            <div className="text-center mt-4 pt-3 border-top">
              <small className="text-muted fw-semibold" style={{ fontSize: '0.75rem' }}>
                <i className="bi bi-shield-check me-1"></i> Ambiente Seguro
              </small>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-vh-100 bg-light d-flex flex-column justify-content-top align-items-center position-relative pb-5">
      {modal.show && (
        <div className="modal fade show d-block vp-modal-overlay" tabIndex="-1" style={{ zIndex: 1050 }}>
          <div className="modal-dialog modal-dialog-centered mx-3 mx-sm-auto">
            <div className="modal-content shadow border-0" style={{ borderRadius: '8px', overflow: 'hidden' }}>
              <div className={`modal-header border-0 ${modal.type === 'confirm' ? 'bg-danger text-white' : 'bg-dark text-white'}`}><h5 className="modal-title fw-bold fs-6">{modal.type === 'confirm' && <i className="bi bi-exclamation-triangle-fill me-2"></i>}{modal.title}</h5><button type="button" className="btn-close btn-close-white" onClick={modal.onClose || modal.onCancel || fecharModal}></button></div>
              <div className="modal-body p-4 fs-6 text-secondary text-center"><p className="mb-0">{modal.message}</p></div>
              <div className="modal-footer border-0 justify-content-center pb-4 flex-column flex-sm-row gap-2"><button type="button" className="vp-btn vp-btn-outline w-100 w-sm-auto m-0" onClick={modal.onCancel || fecharModal}>{modal.cancelText || 'Fechar'}</button>{modal.type === 'confirm' && (<button type="button" className="vp-btn vp-btn-danger w-100 w-sm-auto m-0" onClick={modal.onConfirm}>{modal.confirmText || 'Sim'}</button>)}</div>
            </div>
          </div>
        </div>
      )}

      {showConferencia && (
        <div className="modal fade show d-block vp-modal-overlay" tabIndex="-1" style={{ zIndex: 1050 }}>
          <div className="modal-dialog modal-dialog-centered modal-xl mx-3 mx-sm-auto">
            <div className="modal-content shadow border-0">
              <div className="modal-header border-0 bg-dark text-white"><h5 className="modal-title fw-bold fs-6">Conferência de Leituras</h5><button type="button" className="btn-close btn-close-white" onClick={() => setShowConferencia(false)}></button></div>
              <div className="modal-body p-4 fs-6 text-secondary">
                <p className="mb-2 text-center">Operador: <strong className="text-danger">{crachaLogado}</strong><br /><span className="small text-muted">{leiturasProcessadas.length} resultados.</span></p>
                <FilterControls filters={conferenciaFilters} onFilterChange={setConferenciaFilters} onResetFilters={() => setConferenciaFilters({ lote: '', data_leitura: '', filial: '', deposito: '' })} sortConfig={conferenciaSort} onSortChange={setConferenciaSort} itemsCount={leiturasProcessadas.length} />
                <div className="row g-2 mb-3 mt-1">
                  <div className="col-12 col-sm-6"><label className="form-label small fw-semibold text-secondary mb-1">Filtrar por Filial</label><select className="form-select form-select-sm vp-input" value={conferenciaFilters.filial} onChange={e => setConferenciaFilters(prev => ({ ...prev, filial: e.target.value }))}><option value="">Todas as Filiais</option><option value="1001">1001 (VA - VIDEIRA)</option><option value="1003">1003 (MA - MANAUS)</option><option value="1005">1005 (RA - RIO VERDE)</option><option value="1006">1006 (UA - UNIÃO DA VITÓRIA)</option><option value="1007">1007 (TA - 3 RIOS)</option><option value="1009">1009 (ZA - VARZEA GRANDE)</option><option value="1010">1010 (FA - BARRACÃO DO LIMA)</option></select></div>
                  <div className="col-12 col-sm-6"><label className="form-label small fw-semibold text-secondary mb-1">Filtrar por Depósito</label><select className="form-select form-select-sm vp-input" value={conferenciaFilters.deposito} onChange={e => setConferenciaFilters(prev => ({ ...prev, deposito: e.target.value }))}><option value="">Todos os Depósitos</option>{depositosDisponiveis.map(d => <option key={d.id} value={d.id}>{d.id}</option>)}</select></div>
                </div>

                <div className="table-responsive border rounded d-none d-md-block" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  <table className="table table-hover text-center align-middle mb-0">
                    <thead className="table-light sticky-top" style={{ top: 0, zIndex: 1 }}><tr><th className="py-2">Lote / Romaneio</th>{isAdmin && <th className="py-2">Operador</th>}<th className="py-2">Data/Hora</th></tr></thead>
                    <tbody>
                      {leiturasPaginadas.length === 0 ? (<tr><td colSpan={isAdmin ? 3 : 2} className="text-muted py-4">Nenhuma leitura.</td></tr>) : (
                        Object.entries(leiturasPaginadas.reduce((acc, leitura) => {
                          const dia = leitura.dataHora ? leitura.dataHora.substring(0, 10) : 'Data Desconhecida';
                          const crachaStr = leitura.cracha || 'Desconhecido';
                          const key = `${crachaStr}_${dia}`;
                          if (!acc[key]) acc[key] = { nome: leitura.nome || crachaStr, dia: dia, leituras: [] };
                          acc[key].leituras.push(leitura);
                          return acc;
                        }, {})).map(([key, grupo]) => (
                          <React.Fragment key={key}>
                            <tr className="table-secondary" onClick={() => toggleLoteExpandido(`grupo_${key}`)} style={{ cursor: 'pointer' }}>
                              <td colSpan={isAdmin ? 3 : 2} className="text-start fw-bold text-dark px-4 py-2 border-bottom" style={{ backgroundColor: '#e9ecef' }}>
                                <i className={`bi bi-chevron-${lotesExpandidos[`grupo_${key}`] ? 'down' : 'right'} me-2 text-primary`}></i>
                                <i className="bi bi-person-badge me-2 text-primary"></i>
                                {grupo.nome} <span className="ms-2 text-muted fw-normal" style={{ fontSize: '0.9em' }}>| <i className="bi bi-calendar3 ms-1 me-1"></i> {grupo.dia}</span> <span className="badge bg-primary rounded-pill ms-2">{grupo.leituras.length} leituras</span>
                              </td>
                            </tr>
                            {lotesExpandidos[`grupo_${key}`] && grupo.leituras.map((leitura, index) => {
                              const confKey = `${leitura.codigo}_conf_${index}`; const expandido = lotesExpandidos[confKey];
                              return (
                                <React.Fragment key={index}>
                                  <tr onClick={() => toggleLoteExpandido(confKey)} style={{ cursor: 'pointer' }}>
                                    <td className="fw-bold text-primary text-start px-4">
                                      <i className={`bi bi-chevron-${expandido ? 'down' : 'right'} me-2 text-secondary`}></i>
                                      <span className="vp-mono">{leitura.codigo}</span>
                                    </td>
                                    {isAdmin && <td>{leitura.nome || leitura.cracha}</td>}
                                    <td>{leitura.dataHora}</td>
                                  </tr>
                                  {expandido && (<tr><td colSpan={isAdmin ? 3 : 2} className="p-0 border-0"><div className="p-3 bg-light text-start border-bottom small text-dark animate__animated animate__fadeIn"><div className="row g-3">
                                    <div className="col-12 col-md-4"><div className="vp-detail-block"><span className="vp-detail-label">Material & Descrição</span><div className="vp-detail-val fw-semibold text-dark">{leitura.material !== '-' ? leitura.material : ''} {leitura.material !== '-' && leitura.descricao !== '-' ? '-' : ''} {leitura.descricao !== '-' ? leitura.descricao : ''}</div></div></div>
                                    <div className="col-6 col-md-4"><div className="vp-detail-block"><span className="vp-detail-label">Agrupador</span><div className="vp-detail-val fw-semibold text-dark">{leitura.agrupador || '-'}</div></div></div>
                                    <div className="col-6 col-md-4"><div className="vp-detail-block"><span className="vp-detail-label">Romaneio</span><div className="vp-detail-val fw-semibold text-dark">{leitura.romaneio || '-'}</div></div></div>
                                    <div className="col-6 col-md-6"><div className="vp-detail-block"><span className="vp-detail-label">Endereço Lido</span><div className="vp-detail-val fw-bold text-primary">{leitura.endereco_lido || '-'}</div></div></div>
                                    <div className="col-6 col-md-6"><div className="vp-detail-block"><span className="vp-detail-label">Endereço SAP</span><div className="vp-detail-val fw-semibold text-dark">{leitura.endereco_sap || '-'}</div></div></div>
                                    <div className="col-6 col-md-4"><div className="vp-detail-block"><span className="vp-detail-label">Peso Líquido</span><div className="vp-detail-val fw-semibold text-dark">{leitura.peso_liquido !== '-' ? `${leitura.peso_liquido} kg` : '-'}</div></div></div>
                                    <div className="col-6 col-md-4"><div className="vp-detail-block"><span className="vp-detail-label">Dimensões</span><div className="vp-detail-val fw-semibold text-dark">{leitura.largura !== '-' && leitura.espessura !== '-' ? `${leitura.largura} mm x ${leitura.espessura} µm` : '-'}</div></div></div>
                                    <div className="col-6 col-md-4"><div className="vp-detail-block"><span className="vp-detail-label">Ordem Produção / Venda</span><div className="vp-detail-val fw-semibold text-dark">OP: {leitura.ordem_producao || '-'} / OV: {leitura.ordem_venda || '-'}</div></div></div>
                                    <div className="col-12"><div className="vp-detail-block"><span className="vp-detail-label">Cliente</span><div className="vp-detail-val fw-semibold text-dark">{leitura.cliente !== '-' ? leitura.cliente : ''} {leitura.cliente !== '-' && leitura.nome_cliente !== '-' ? '-' : ''} {leitura.nome_cliente !== '-' ? leitura.nome_cliente : ''}</div></div></div>
                                    <div className="col-12"><div className="vp-detail-block"><span className="vp-detail-label">Rota</span><div className="vp-detail-val fw-semibold text-dark">{leitura.rota || '-'}</div></div></div>
                                  </div></div></td></tr>)}
                                </React.Fragment>
                              );
                            })}
                          </React.Fragment>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="d-md-none" style={{ maxHeight: '60vh', overflowY: 'auto', margin: '-1rem', padding: '1rem', backgroundColor: '#f8f9fa' }}>
                  <div className="vp-mobile-cards-list">
                    {leiturasPaginadas.length === 0 ? (
                        <div className="text-center text-muted p-4">Nenhuma leitura.</div>
                    ) : (
                        Object.entries(leiturasPaginadas.reduce((acc, leitura) => {
                          const dia = leitura.dataHora ? leitura.dataHora.substring(0, 10) : 'Data Desconhecida';
                          const crachaStr = leitura.cracha || 'Desconhecido';
                          const key = `${crachaStr}_${dia}`;
                          if (!acc[key]) acc[key] = { nome: leitura.nome || crachaStr, dia: dia, leituras: [] };
                          acc[key].leituras.push(leitura);
                          return acc;
                        }, {})).map(([key, grupo]) => (
                          <div key={key} className="mb-4">
                            <div className="p-3 rounded mb-3 shadow-sm border bg-white position-relative overflow-hidden" onClick={() => toggleLoteExpandido(`grupo_${key}`)} style={{ cursor: 'pointer', transition: 'all 0.2s ease' }}>
                              <div className="position-absolute start-0 top-0 bottom-0 bg-primary" style={{ width: '4px' }}></div>
                              <div className="d-flex align-items-center w-100 ps-2">
                                <div className="rounded-circle bg-light d-flex align-items-center justify-content-center me-3 border" style={{ width: '42px', height: '42px', flexShrink: 0 }}>
                                  <i className="bi bi-person-fill text-secondary fs-5"></i>
                                </div>
                                <div className="flex-grow-1" style={{ minWidth: 0 }}>
                                  <div className="fw-bold text-dark text-truncate mb-1" style={{ fontSize: '0.95rem' }}>
                                    {grupo.nome}
                                  </div>
                                  <div className="d-flex align-items-center gap-2 flex-wrap">
                                    <span className="badge bg-light border text-secondary fw-semibold rounded-pill px-2 py-1 d-flex align-items-center" style={{ fontSize: '0.7rem' }}>
                                      <i className="bi bi-calendar3 me-1"></i>{grupo.dia}
                                    </span>
                                    <span className="badge bg-primary bg-opacity-10 text-primary fw-bold rounded-pill px-2 py-1" style={{ fontSize: '0.7rem' }}>
                                      {grupo.leituras.length} leitura{grupo.leituras.length !== 1 ? 's' : ''}
                                    </span>
                                  </div>
                                </div>
                                <div className="ms-2 text-muted" style={{ flexShrink: 0 }}>
                                  <i className={`bi bi-chevron-${lotesExpandidos[`grupo_${key}`] ? 'up' : 'down'}`}></i>
                                </div>
                              </div>
                            </div>
                            {lotesExpandidos[`grupo_${key}`] && grupo.leituras.map((leitura, index) => {
                              const confKey = `${leitura.codigo}_conf_${index}`; const expandido = lotesExpandidos[confKey];
                              return (
                                <div key={index} className={`vp-mobile-report-card ok shadow-sm border ${expandido ? 'expanded' : ''}`} onClick={() => toggleLoteExpandido(confKey)} style={{ cursor: 'pointer', padding: '1rem', marginBottom: '0.75rem', borderRadius: '0.75rem', backgroundColor: '#ffffff', position: 'relative' }}>
                                  <div className="d-flex justify-content-between align-items-center mb-1">
                                    <div className="d-flex align-items-center">
                                      <i className="bi bi-box-seam me-2 text-primary"></i> 
                                      <span className="vp-mono fw-bold text-dark fs-6">{leitura.codigo}</span>
                                    </div>
                                    <div className="text-muted small fw-semibold">
                                      <i className="bi bi-clock me-1"></i>{leitura.dataHora.includes(' ') ? leitura.dataHora.split(' ')[1] : leitura.dataHora}
                                    </div>
                                  </div>
                                  {!expandido && (
                                    <div className="text-center mt-2 text-primary" style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                                      <i className="bi bi-chevron-down me-1"></i>Ver detalhes
                                    </div>
                                  )}
                                  {expandido && (
                                    <div className="vp-mobile-card-extra border-top pt-3 mt-3 animate__animated animate__fadeIn">
                                      <div className="mb-3">
                                        <div className="text-muted text-uppercase fw-bold mb-1" style={{ fontSize: '0.65rem', letterSpacing: '0.5px' }}>Material & Descrição</div>
                                        <div className="fw-semibold text-dark small">{leitura.material !== '-' ? leitura.material : ''} {leitura.material !== '-' && leitura.descricao !== '-' ? '-' : ''} {leitura.descricao !== '-' ? leitura.descricao : ''}</div>
                                      </div>
                                      <div className="row g-3">
                                        <div className="col-6"><div className="text-muted text-uppercase fw-bold mb-1" style={{ fontSize: '0.65rem', letterSpacing: '0.5px' }}>Agrupador</div><div className="fw-semibold text-dark small">{leitura.agrupador || '-'}</div></div>
                                        <div className="col-6"><div className="text-muted text-uppercase fw-bold mb-1" style={{ fontSize: '0.65rem', letterSpacing: '0.5px' }}>Romaneio</div><div className="fw-semibold text-dark small">{leitura.romaneio || '-'}</div></div>
                                        <div className="col-12"><div className="text-muted text-uppercase fw-bold mb-1" style={{ fontSize: '0.65rem', letterSpacing: '0.5px' }}>Endereço Lido</div><div className="fw-bold text-primary small bg-primary bg-opacity-10 px-2 py-1 rounded d-inline-block">{leitura.endereco_lido || '-'}</div></div>
                                        <div className="col-12"><div className="text-muted text-uppercase fw-bold mb-1" style={{ fontSize: '0.65rem', letterSpacing: '0.5px' }}>Endereço SAP</div><div className="fw-semibold text-dark small">{leitura.endereco_sap || '-'}</div></div>
                                        <div className="col-6"><div className="text-muted text-uppercase fw-bold mb-1" style={{ fontSize: '0.65rem', letterSpacing: '0.5px' }}>Peso Líquido</div><div className="fw-semibold text-dark small">{leitura.peso_liquido !== '-' ? `${leitura.peso_liquido} kg` : '-'}</div></div>
                                        <div className="col-6"><div className="text-muted text-uppercase fw-bold mb-1" style={{ fontSize: '0.65rem', letterSpacing: '0.5px' }}>Dimensões</div><div className="fw-semibold text-dark small">{leitura.largura !== '-' && leitura.espessura !== '-' ? `${leitura.largura} mm x ${leitura.espessura} µm` : '-'}</div></div>
                                        <div className="col-12"><div className="text-muted text-uppercase fw-bold mb-1" style={{ fontSize: '0.65rem', letterSpacing: '0.5px' }}>Ordem Prod/Venda</div><div className="fw-semibold text-dark small">OP: {leitura.ordem_producao || '-'} / OV: {leitura.ordem_venda || '-'}</div></div>
                                        <div className="col-12"><div className="text-muted text-uppercase fw-bold mb-1" style={{ fontSize: '0.65rem', letterSpacing: '0.5px' }}>Cliente</div><div className="fw-semibold text-dark small">{leitura.cliente !== '-' ? leitura.cliente : ''} {leitura.cliente !== '-' && leitura.nome_cliente !== '-' ? '-' : ''} {leitura.nome_cliente !== '-' ? leitura.nome_cliente : ''}</div></div>
                                        <div className="col-12"><div className="text-muted text-uppercase fw-bold mb-1" style={{ fontSize: '0.65rem', letterSpacing: '0.5px' }}>Rota</div><div className="fw-semibold text-dark small">{leitura.rota || '-'}</div></div>
                                      </div>
                                      <div className="text-center mt-3 text-muted border-top pt-2" style={{ fontSize: '0.75rem' }}><i className="bi bi-chevron-up me-1"></i>Recolher</div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ))
                    )}
                  </div>
                </div>
                {totalPaginas > 1 && (<div className="d-flex justify-content-between align-items-center mt-3 pt-3 border-top"><button className="vp-btn vp-btn-outline vp-btn-sm px-3" onClick={() => setPaginaAtual(prev => Math.max(prev - 1, 1))} disabled={paginaAtual === 1}>Anterior</button><span className="small text-muted fw-semibold">Página {paginaCorrigida} de {totalPaginas}</span><button className="vp-btn vp-btn-outline vp-btn-sm px-3" onClick={() => setPaginaAtual(prev => Math.min(prev + 1, totalPaginas))} disabled={paginaAtual === totalPaginas}>Próxima</button></div>)}
              </div>
              <div className="modal-footer border-0 justify-content-center pb-4"><button type="button" className="vp-btn vp-btn-dark w-100 w-sm-auto" onClick={() => setShowConferencia(false)}>Fechar</button></div>
            </div>
          </div>
        </div>
      )}

      <div className="container px-3 px-md-0 pt-2 pb-5" style={{ maxWidth: '800px', width: '100%' }}>
        <Header />
        <div className="vp-operator-card animate__animated animate__fadeIn mb-4">
          <div className="vp-operator-info"><div className="vp-operator-avatar">{obterIniciais(nomeLogado)}</div><div><span className="vp-micro-label" style={{ margin: 0 }}>Operador Logado</span><h4 className="vp-operator-name">{nomeLogado}</h4><span className="vp-operator-badge"><i className="bi bi-person-badge"></i> {crachaLogado}</span></div></div>
          <div className="vp-operator-actions"><button className="vp-btn vp-btn-outline" onClick={abrirConferenciaAdmin} disabled={carregandoAcao}><i className="bi bi-list-check"></i> Conferência</button><button className="vp-btn vp-btn-ghost-danger" onClick={fazerLogout} disabled={carregandoAcao}><i className="bi bi-box-arrow-right"></i> Sair</button></div>
        </div>

        <main>
          <div className="vp-card vp-sap-card no-hover animate__animated animate__fadeIn mb-4">
            <div className="vp-sap-info"><div className="vp-sap-icon"><i className="bi bi-filetype-csv"></i></div><div><h3 className="vp-title">Relatório SAP</h3><p className="vp-subtitle">Importe a planilha atualizada.</p></div></div>
            <div className="w-100 w-sm-auto"><input type="file" accept=".csv" className="d-none" ref={fileInputRef} onChange={importarCSV} id="csvUpload" disabled={carregandoAcao} /><label htmlFor="csvUpload" className={`vp-btn vp-btn-outline w-100 w-sm-auto d-flex justify-content-center align-items-center ${carregandoAcao ? 'disabled' : ''}`}>{carregandoAcao ? <span className="spinner-border spinner-border-sm" role="status"></span> : <i className="bi bi-cloud-upload"></i>} {carregandoAcao ? 'Lendo...' : 'Importar Planilha'}</label></div>
          </div>

          <div className="vp-card no-hover mb-4 animate__animated animate__fadeIn" style={{ margin: 0 }}>

            {etapaInventario === 'OCIOSO' && (
              <div className="text-center py-4 animate__animated animate__fadeIn">
                <div className="d-inline-flex align-items-center justify-content-center bg-light rounded-circle mb-3" style={{ width: '80px', height: '80px' }}>
                  <i className="bi bi-boxes text-dark" style={{ fontSize: '2.5rem' }}></i>
                </div>
                <h2 className="vp-title mb-4">Pronto para a Contagem</h2>
                <div className="mx-auto" style={{ maxWidth: '300px' }}>
                  <button className="vp-btn vp-btn-primary vp-btn-lg w-100 shadow-sm" onClick={() => setEtapaInventario('ESCOLHER_TIPO_CONTAGEM')}>
                    <i className="bi bi-play-circle-fill"></i> Iniciar Inventário
                  </button>
                </div>
              </div>
            )}

            {etapaInventario === 'ESCOLHER_TIPO_CONTAGEM' && (
              <div className="text-center py-2 animate__animated animate__zoomIn animate__faster">
                <span className="vp-micro-label mb-3">Configuração inicial</span>
                <h3 className="vp-title mb-4">O inventário será por Lote ou por Romaneio?</h3>
                <div className="row g-3 mb-4">
                  <div className="col-12 col-md-6">
                    <button 
                      className="vp-btn vp-btn-outline p-4 d-flex flex-column align-items-center justify-content-center w-100 h-100 vp-modo-card" 
                      onClick={() => { setTipoContagem('LOTE'); setEtapaInventario('ESCOLHER_MODO'); }}
                    >
                      <div className="bg-light rounded-circle p-3 mb-3">
                        <i className="bi bi-box-seam fs-3 vp-modo-icon" style={{ color: 'var(--vp-primary)' }}></i>
                      </div>
                      <span className="fw-bold fs-5 text-dark">Por Lote</span>
                      <span className="small text-muted mt-2 fw-normal text-wrap">Validar e registrar apenas lotes de bobinas.</span>
                    </button>
                  </div>
                  <div className="col-12 col-md-6">
                    <button 
                      className="vp-btn vp-btn-outline p-4 d-flex flex-column align-items-center justify-content-center w-100 h-100 vp-modo-card" 
                      onClick={() => { setTipoContagem('ROMANEIO'); setEtapaInventario('ESCOLHER_MODO'); }}
                    >
                      <div className="bg-light rounded-circle p-3 mb-3">
                        <i className="bi bi-file-earmark-text fs-3 text-secondary vp-modo-icon"></i>
                      </div>
                      <span className="fw-bold fs-5 text-dark">Por Romaneio</span>
                      <span className="small text-muted mt-2 fw-normal text-wrap">Validar e registrar apenas romaneios.</span>
                    </button>
                  </div>
                </div>
                <button className="vp-btn vp-btn-ghost-danger w-100 text-decoration-none" onClick={() => { setEtapaInventario('OCIOSO'); setTipoContagem(null); }}>Cancelar</button>
              </div>
            )}

            {etapaInventario === 'ESCOLHER_MODO' && (
              <div className="text-center py-2 animate__animated animate__zoomIn animate__faster">
                <span className="vp-micro-label mb-3">Modo de Inventário</span><h3 className="vp-title mb-4">Como deseja realizar a contagem?</h3>
                <div className="row g-3 mb-4">
                  <div className="col-12 col-md-6">
                    <button className="vp-btn vp-btn-outline p-4 d-flex flex-column align-items-center justify-content-center w-100 h-100 vp-modo-card" onClick={() => { setModoInventario('COM_ENDERECO'); setEtapaInventario('INFORMAR_ENDERECO'); }}>
                      <div className="bg-light rounded-circle p-3 mb-3">
                        <i className="bi bi-geo-alt-fill fs-3 vp-modo-icon" style={{ color: 'var(--vp-primary)' }}></i>
                      </div>
                      <span className="fw-bold fs-5 text-dark">Com Endereço</span>
                      <span className="small text-muted mt-2 fw-normal text-wrap">Informar depósito/gaveta.</span>
                    </button>
                  </div>
                  <div className="col-12 col-md-6">
                    <button className="vp-btn vp-btn-outline p-4 d-flex flex-column align-items-center justify-content-center w-100 h-100 vp-modo-card" onClick={() => { setModoInventario('SEM_ENDERECO'); setEtapaInventario('BIPANDO'); }}>
                      <div className="bg-light rounded-circle p-3 mb-3">
                        <i className="bi bi-qr-code-scan fs-3 text-secondary vp-modo-icon"></i>
                      </div>
                      <span className="fw-bold fs-5 text-dark">Sem Endereço</span>
                      <span className="small text-muted mt-2 fw-normal text-wrap">Bipagem livre.</span>
                    </button>
                  </div>
                </div>
                <button className="vp-btn vp-btn-ghost-danger w-100 text-decoration-none" onClick={() => setEtapaInventario('OCIOSO')}>Cancelar</button>
              </div>
            )}

            {etapaInventario === 'INFORMAR_ENDERECO' && (
              <div className="text-center py-4 animate__animated animate__fadeInRight animate__faster">
                <span className="vp-micro-label mb-2">Endereçamento</span>
                <div className="mx-auto" style={{ maxWidth: '500px' }}>

                  <div className="mb-4 text-start">
                    <label className="form-label small fw-bold text-secondary mb-1">Depósito</label>
                    <select
                      className="form-select form-select-lg shadow-sm vp-input-destaque"
                      value={depositoAtual}
                      onChange={e => {
                        setDepositoAtual(e.target.value);
                        setGondolaAtual('');
                        setGavetaAtual('');
                      }}
                      style={{ fontSize: '1.1rem', height: '54px', borderColor: 'var(--vp-border)', cursor: 'pointer' }}
                    >
                      <option value="">Selecione o Depósito...</option>
                      {depositosDisponiveis.map(d => (
                        <option key={d.id} value={d.id}>{d.id} - {d.nome} {d.requerEndereco ? '(Gôndola/Gaveta)' : '(S/ Endereço)'}</option>
                      ))}
                    </select>
                  </div>

                  {depositosDisponiveis.find(d => d.id === depositoAtual)?.requerEndereco && (
                    <div className="row g-2 mb-4 animate__animated animate__fadeIn">
                      <div className="mb-4 text-start">
                        <label className="form-label small fw-bold text-secondary mb-1">Rota (Opcional)</label>
                        <select 
                          className="form-select form-select-lg shadow-sm vp-input-destaque"
                          value={rotaAtual}
                          onChange={e => setRotaAtual(e.target.value)}
                          style={{ fontSize: '1.1rem', height: '54px', borderColor: 'var(--vp-border)' }}
                      >
                          <option value="">Nenhuma Rota selecionada</option>
                          {rotasDisponiveis.map((r) => (<option key={r.id} value={r.id}>{r.rota}</option>))}
                      </select>
                      </div>
                      <div className="col-6 text-start"><label className="form-label small fw-bold text-secondary mb-2">Gôndola (Opcional)</label><input ref={gondolaInputRef} type="text" className="form-control form-control-lg w-100 text-center shadow-sm" placeholder="Ex: G01" value={gondolaAtual} onChange={e => setGondolaAtual(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && gavetaInputRef.current?.focus()} style={{ height: '54px' }} /></div>
                      <div className="col-6 text-start"><label className="form-label small fw-bold text-secondary mb-1">Gaveta / Posição</label><input ref={gavetaInputRef} type="text" className="vp-input vp-input-lg w-100 text-center shadow-sm vp-input-destaque" placeholder="Ex: A1" value={gavetaAtual} onChange={e => setGavetaAtual(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && avancarParaInformarEndereco()} /></div>
                    </div>
                  )}

                  <div className="row g-2"><div className="col-6"><button className="vp-btn vp-btn-outline vp-btn-lg w-100" onClick={() => setEtapaInventario('ESCOLHER_MODO')}>Voltar</button></div><div className="col-6"><button className="vp-btn vp-btn-primary vp-btn-lg w-100 shadow-sm" onClick={avancarParaInformarEndereco}>Avançar <i className="bi bi-arrow-right"></i></button></div></div>
                </div>
              </div>
            )}

            {etapaInventario === 'BIPANDO' && (
              <div className="animate__animated animate__fadeIn animate__faster">
                <div className="d-flex justify-content-between align-items-center mb-4 pb-3 border-bottom">
                  <div>
                    <span className="vp-micro-label m-0">Leitura Ativa</span>
                    {modoInventario === 'COM_ENDERECO' ? (
                      <h4 className="vp-title text-primary mb-0 mt-1 fs-6 lh-base w-100 text-break">
                        <i className="bi bi-geo-alt-fill"></i> {nomeRotaAtiva ? `Rota: ${nomeRotaAtiva} | ` : ''}{depositosDisponiveis.find(d => d.id === depositoAtual)?.requerEndereco ? `${depositoAtual}${gondolaAtual.trim() ? ` | G: ${gondolaAtual}` : ''} | P: ${gavetaAtual}` : `Depósito: ${depositoAtual}`}
                      </h4>
                    ) : (
                      <h4 className="vp-title text-secondary mb-0 mt-1"><i className="bi bi-upc-scan"></i> Bipagem Livre</h4>
                    )}
                    {tipoContagem && (
                      <div className="mt-2">
                        <span className={`badge ${tipoContagem === 'LOTE' ? 'bg-primary' : 'bg-success'} rounded-pill px-3 py-1 fw-bold shadow-sm`} style={{ fontSize: '0.8rem', letterSpacing: '0.3px' }}>
                          <i className={tipoContagem === 'LOTE' ? 'bi bi-box-seam me-1' : 'bi bi-file-earmark-text me-1'}></i>
                          Contagem por: {tipoContagem}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="d-flex flex-column align-items-end gap-2">
                    {/* Badge de status de conectividade */}
                    {!isOnline ? (
                      <span className="badge vp-badge-offline" title="Sem conexão — leituras salvas localmente">
                        <span className="vp-badge-dot vp-badge-dot-offline"></span>
                        Offline {pendingCount > 0 ? `— ${pendingCount} na fila` : ''}
                      </span>
                    ) : pendingCount > 0 ? (
                      <span className="badge vp-badge-syncing" title="Sincronizando leituras pendentes..." onClick={syncNow} style={{cursor:'pointer'}}>
                        <span className="vp-badge-dot vp-badge-dot-syncing"></span>
                        Sincronizando {pendingCount}...
                      </span>
                    ) : (
                      <span className="badge vp-badge-online" title="Online — todas as leituras sincronizadas">
                        <span className="vp-badge-dot vp-badge-dot-online"></span>
                        Online
                      </span>
                    )}
                    {modoInventario === 'COM_ENDERECO' ? (
                      <button className="vp-btn vp-btn-success" onClick={finalizarGaveta}>
                        <i className="bi bi-check2-all"></i> {depositosDisponiveis.find(d => d.id === depositoAtual)?.requerEndereco ? 'Finalizar Gaveta' : 'Finalizar Depósito'}
                      </button>
                    ) : (
                      <button className="vp-btn vp-btn-outline-danger" onClick={encerrarInventarioLivre}><i className="bi bi-stop-circle"></i> Encerrar</button>
                    )}
                  </div>
                </div>

                {usandoDrone ? (<ProcessadorDrone aoConcluir={processarLoteDrone} aoCancelar={() => setUsandoDrone(false)} />) : usandoCamera ? (<Scanner aoLerCodigo={adicionarBobina} aoCancelar={() => setUsandoCamera(false)} />) : (
                  <>
                    <div className="bg-white p-3 p-md-4 rounded border mb-4 shadow-sm">
                      <label className="form-label fw-bold text-secondary mb-3"><i className="bi bi-keyboard"></i> Digitação ou Leitor USB</label>
                      <textarea
                        ref={inputRef}
                        className="vp-input w-100 bg-light mb-3 vp-input-destaque p-3"
                        placeholder="Informe lotes ou romaneios..."
                        value={codigo}
                        onChange={(e) => setCodigo(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (!carregandoAcao && codigo.trim() !== '') adicionarBobina();
                          }
                        }}
                        disabled={carregandoAcao}
                        rows={6}
                        style={{ resize: 'none', fontSize: '1.0rem', lineHeight: '1.5' }}
                      />
                      <button
                        className="vp-btn vp-btn-primary vp-btn-lg w-100 shadow-sm"
                        onClick={() => adicionarBobina()}
                        disabled={carregandoAcao || codigo.trim() === ''}
                      >
                        <i className="bi bi-plus-circle-fill"></i> Processar Códigos
                      </button>
                    </div>

                    <div className="d-flex align-items-center mb-4">
                      <div className="flex-grow-1 border-bottom"></div>
                      <span className="px-3 text-muted small fw-bold">OU UTILIZE A CÂMERA</span>
                      <div className="flex-grow-1 border-bottom"></div>
                    </div>

                    <div className="row g-2">
                      <div className={modoInventario === 'SEM_ENDERECO' ? "col-12 col-sm-6" : "col-12"}>
                        <button className="vp-btn vp-btn-outline-danger w-100" onClick={() => setUsandoCamera(true)} disabled={carregandoAcao}>
                          <i className="bi bi-camera-fill fs-5"></i> Câmera Celular
                        </button>
                      </div>
                      {modoInventario === 'SEM_ENDERECO' && (
                        <div className="col-12 col-sm-6">
                          <button className="vp-btn vp-btn-outline-warning w-100" onClick={() => setUsandoDrone(true)} disabled={carregandoAcao}>
                            <i className="bi bi-send-check-fill fs-5"></i> Processar Drone
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="vp-counters-container animate__animated animate__fadeIn mb-4">
            <div className="vp-counter-card esperadas"><div className="vp-counter-header"><span className="vp-counter-label">Esperadas</span><i className="bi bi-calculator"></i></div><h3 className="vp-counter-value">{qtdEsperadas}</h3></div>
            <div className="vp-counter-card lidas"><div className="vp-counter-header"><span className="vp-counter-label">Lidas</span><i className="bi bi-check-circle"></i></div><h3 className="vp-counter-value">{qtdLidas}</h3></div>
            <div className="vp-counter-card faltam"><div className="vp-counter-header"><span className="vp-counter-label">Faltam</span><i className="bi bi-exclamation-circle"></i></div><h3 className="vp-counter-value">{qtdFaltam}</h3></div>
          </div>

          <div className="vp-bottom-actions animate__animated animate__fadeIn mb-4">
            <button onClick={gerarRelatorio} className="vp-btn vp-btn-outline-success vp-btn-lg w-100"><i className="bi bi-file-earmark-spreadsheet fs-5"></i> Exportar Relatório Conciliado</button>
            <button onClick={limparDados} className="vp-btn vp-btn-ghost-danger vp-btn-lg w-100 mt-2"><i className="bi bi-arrow-counterclockwise fs-5"></i> Iniciar Novo Inventário</button>
          </div>

          {relatorioNaTela.length > 0 && (
            <>
              <div className="vp-desktop-table-wrapper card shadow-sm border-0 mb-4 animate__animated animate__fadeIn overflow-hidden">
                <div className="card-body p-0 table-responsive">
                  <table className="table table-hover mb-0 text-center align-middle" style={{ whiteSpace: 'nowrap' }}>
                    <thead className="table-dark"><tr><th className="py-3 px-3 text-start text-sm-center" style={{ width: '40%' }}>Lote / Romaneio</th><th className="py-3 px-3" style={{ width: '40%' }}>Status</th><th className="py-3 px-3" style={{ width: '20%' }}>Ação</th></tr></thead>
                    <tbody>
                      {relatorioNaTela.map((item, idx) => {
                        const expandido = lotesExpandidos[item.codigo];
                        
                        return (
                          <React.Fragment key={idx}>
                            <tr className={`vp-table-row-main ${item.tipo === 'faltando' ? 'table-danger opacity-75' : ''} ${expandido ? 'vp-row-expanded' : ''}`} onClick={() => toggleLoteExpandido(item.codigo)} style={{ cursor: 'pointer' }}>
                              
                              <td className="fw-bold py-3 px-3 text-start text-sm-center">
                                <i className={`bi bi-chevron-${expandido ? 'down' : 'right'} me-2 text-secondary`}></i>
                                <span className="vp-mono">{item.codigo}</span>
                                {item.rota && item.rota !== '-' && <span className="badge bg-info text-dark ms-2 px-2 py-1 rounded-pill border border-info" style={{fontSize: '0.75rem'}}><i className="bi bi-geo me-1"></i>{item.rota}</span>}
                              </td>
                              
                              <td className="px-3">
                                {item.tipo === 'ok' && <span className="badge bg-success w-100 py-2">OK (Lida)</span>}
                                {item.tipo === 'faltando' && <span className="badge bg-danger w-100 py-2">Faltando</span>}
                                {item.tipo === 'sobrando' && <span className="badge bg-warning text-dark w-100 py-2">Sobra</span>}
                                {item.tipo === 'divergencia' && <span className="badge w-100 py-2" style={{ backgroundColor: '#fd7e14' }}>Local Incorreto</span>}
                                {!item.tipo && <span className="badge bg-secondary w-100 py-2">{item.status}</span>}
                              </td>
                              
                              <td className="px-3" onClick={(e) => e.stopPropagation()}>
                                {item.tipo !== 'faltando' && (
                                    <button className="vp-btn vp-btn-outline-danger border-0 p-2" onClick={() => removerBobina(item.codigo)} title="Excluir leitura" disabled={carregandoAcao}><i className="bi bi-trash fs-5 m-0"></i></button>
                                )}
                              </td>
                            </tr>
                            
                            {expandido && (
                              <tr className="vp-table-row-details">
                                <td colSpan="3" className="p-0 border-0">
                                  <div className="vp-row-details-content p-3 bg-light text-start border-bottom">
                                    <div className="row g-3">
                                      <div className="col-12 col-md-4"><div className="vp-detail-block"><span className="vp-detail-label">Material & Descrição</span><div className="vp-detail-val fw-semibold text-dark">{item.material !== '-' ? item.material : ''} {item.material !== '-' && item.descricao !== '-' ? '-' : ''} {item.descricao !== '-' ? item.descricao : ''}</div></div></div>
                                      <div className="col-6 col-md-4"><div className="vp-detail-block"><span className="vp-detail-label">Agrupador</span><div className="vp-detail-val fw-semibold text-dark">{item.agrupador || '-'}</div></div></div>
                                      <div className="col-6 col-md-4"><div className="vp-detail-block"><span className="vp-detail-label">ROMANEIO</span><div className="vp-detail-val fw-semibold text-dark">{item.romaneio || '-'}</div></div></div>
                                      <div className="col-6 col-md-6"><div className="vp-detail-block"><span className="vp-detail-label">Endereço Lido</span><div className="vp-detail-val fw-bold text-primary">{item.endereco_lido || '-'}</div></div></div>
                                      <div className="col-6 col-md-6"><div className="vp-detail-block"><span className="vp-detail-label">Endereço SAP</span><div className="vp-detail-val fw-semibold text-dark">{item.endereco_sap || '-'}</div></div></div>
                                      <div className="col-6 col-md-4"><div className="vp-detail-block"><span className="vp-detail-label">Peso Líquido</span><div className="vp-detail-val fw-semibold text-dark">{item.peso_liquido !== '-' ? `${item.peso_liquido} kg` : '-'}</div></div></div>
                                      <div className="col-6 col-md-4"><div className="vp-detail-block"><span className="vp-detail-label">Dimensões</span><div className="vp-detail-val fw-semibold text-dark">{item.largura !== '-' && item.espessura !== '-' ? `${item.largura} mm x ${item.espessura} µm` : '-'}</div></div></div>
                                      <div className="col-6 col-md-4"><div className="vp-detail-block"><span className="vp-detail-label">Ordem Produção / Venda</span><div className="vp-detail-val fw-semibold text-dark">OP: {item.ordem_producao || '-'} / OV: {item.ordem_venda || '-'}</div></div></div>
                                      <div className="col-12"><div className="vp-detail-block"><span className="vp-detail-label">Cliente</span><div className="vp-detail-val fw-semibold text-dark">{item.cliente !== '-' ? item.cliente : ''} {item.cliente !== '-' && item.nome_cliente !== '-' ? '-' : ''} {item.nome_cliente !== '-' ? item.nome_cliente : ''}</div></div></div>
                                      <div className="col-12"><div className="vp-detail-block"><span className="vp-detail-label">Rota</span><div className="vp-detail-val fw-semibold text-dark">{item.rota || '-'}</div></div></div>
                                      {item.tipo !== 'faltando' && (<div className="col-12 border-top pt-2 mt-2"><small className="text-muted"><i className="bi bi-clock me-1"></i>{item.dataHora !== '-' ? `Bipada em ${item.dataHora} por ${item.nome_operador} (${item.cracha})` : 'Aguardando bipagem.'}</small></div>)}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              
              <div className="d-md-none" style={{ maxHeight: '60vh', overflowY: 'auto', margin: '-1rem', padding: '1rem', backgroundColor: '#f8f9fa' }}>
                <div className="vp-mobile-cards-list">
                  {relatorioNaTela.map((item, idx) => {
                    const expandido = lotesExpandidos[item.codigo];
                    return (
                      <div key={idx} className={`vp-mobile-report-card ${item.tipo || 'default'} ${expandido ? 'expanded' : ''}`} onClick={() => toggleLoteExpandido(item.codigo)} style={{ cursor: 'pointer' }}>
                        <div className="vp-mobile-card-header">
                          <span className="vp-mobile-card-lote">
                            <i className={`bi bi-chevron-${expandido ? 'down' : 'right'} me-2 text-secondary`}></i>
                            <i className="bi bi-box-seam me-1 text-primary"></i> 
                            <span className="vp-mono">{item.codigo}</span>
                            {item.rota && item.rota !== '-' && <span className="badge bg-info text-dark ms-2 px-2 py-1 rounded-pill" style={{fontSize: '0.7rem'}}>{item.rota}</span>}
                          </span>
                          <div className="vp-mobile-card-actions" onClick={(e) => e.stopPropagation()}>{item.tipo !== 'faltando' && (<button className="vp-btn-delete" onClick={() => removerBobina(item.codigo)} disabled={carregandoAcao} title="Excluir leitura"><i className="bi bi-trash m-0"></i></button>)}</div>
                        </div>
                        <div className="vp-mobile-card-body">
                          <div className="vp-mobile-card-row">
                            <span className="vp-mobile-card-label">Status:</span>
                            <span className={`vp-mobile-card-badge ${item.tipo || 'default'}`}>
                              {item.tipo === 'ok' && 'Lida / SAP OK'}
                              {item.tipo === 'faltando' && 'Faltando (Não Bipada)'}
                              {item.tipo === 'sobrando' && 'Sobrando (Não SAP)'}
                              {item.tipo === 'divergencia' && 'Lida em Local Incorreto'}
                              {!item.tipo && item.status}
                            </span>
                          </div>
                          <div className="vp-mobile-card-details">
                            {item.tipo !== 'faltando' && (<><div className="vp-detail-item"><span className="vp-detail-label">Data/Hora:</span><span className="vp-detail-value">{item.dataHora || '-'}</span></div><div className="vp-detail-item"><span className="vp-detail-label">Operador:</span><span className="vp-detail-value">{item.nome_operador || '-'}</span></div></>)}
                          </div>
                          {expandido && (
                            <div className="vp-mobile-card-extra border-top pt-2 mt-2">
                              <div className="vp-detail-block mb-2"><span className="vp-detail-label">Material & Descrição</span><div className="vp-detail-val small fw-semibold text-dark">{item.material !== '-' ? item.material : ''} {item.material !== '-' && item.descricao !== '-' ? '-' : ''} {item.descricao !== '-' ? item.descricao : ''}</div></div>
                              <div className="row g-2 mb-2">
                                <div className="col-6"><div className="vp-detail-block"><span className="vp-detail-label">Agrupador</span><div className="vp-detail-val small fw-semibold text-dark">{item.agrupador || '-'}</div></div></div>
                                <div className="col-6"><div className="vp-detail-block"><span className="vp-detail-label">Romaneio</span><div className="vp-detail-val small fw-semibold text-dark">{item.romaneio || '-'}</div></div></div>
                                <div className="col-6"><div className="vp-detail-block"><span className="vp-detail-label">Filial</span><div className="vp-detail-val small fw-semibold text-dark">{item.filial || '-'}</div></div></div>
                                <div className="col-6"><div className="vp-detail-block"><span className="vp-detail-label">Endereço Lido</span><div className="vp-detail-val small fw-bold text-primary">{item.endereco_lido || '-'}</div></div></div>
                                <div className="col-6"><div className="vp-detail-block"><span className="vp-detail-label">Endereço SAP</span><div className="vp-detail-val small fw-semibold text-dark">{item.endereco_sap || '-'}</div></div></div>
                                <div className="col-6"><div className="vp-detail-block"><span className="vp-detail-label">Peso Líquido</span><div className="vp-detail-val small fw-semibold text-dark">{item.peso_liquido !== '-' ? `${item.peso_liquido} kg` : '-'}</div></div></div>
                                <div className="col-6"><div className="vp-detail-block"><span className="vp-detail-label">Dimensões</span><div className="vp-detail-val small fw-semibold text-dark">{item.largura !== '-' && item.espessura !== '-' ? `${item.largura} mm x ${item.espessura} µm` : '-'}</div></div></div>
                                <div className="col-12"><div className="vp-detail-block"><span className="vp-detail-label">Ordem Produção / Venda</span><div className="vp-detail-val small fw-semibold text-dark">OP: {item.ordem_producao || '-'} / OV: {item.ordem_venda || '-'}</div></div></div>
                                <div className="col-12"><div className="vp-detail-block"><span className="vp-detail-label">Rota</span><div className="vp-detail-val small fw-semibold text-dark">{item.rota || '-'}</div></div></div>
                              </div>
                              <div className="vp-detail-block"><span className="vp-detail-label">Cliente</span><div className="vp-detail-val small fw-semibold text-dark">{item.cliente !== '-' ? item.cliente : ''} {item.cliente !== '-' && item.nome_cliente !== '-' ? '-' : ''} {item.nome_cliente !== '-' ? item.nome_cliente : ''}</div></div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

export default App