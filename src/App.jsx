import React, { useState, useRef, useEffect, useMemo } from 'react'
import Header from './components/Header'
import Scanner from './components/Scanner'
import logoVideplast from './assets/videplast-brand.png'
import { supabase } from './supabase'
import ProcessadorDrone from './components/ProcessadorDrone'
import db from './db'
import { useSyncManager } from './hooks/useSyncManager'
import { aguardarSincronizacao, ehErroPermanente, enviarSessoesPendentes, gerarUuid, migrarSessaoLegada, registrarSessaoLocal, sessaoPendenteLocal, sinalTimeout } from './sync'
import { buscarPorValores, buscarTodasPaginas, salvarBaseSap } from './lib/consultas'
import { baixarCSV, campoCSV } from './lib/csv'
import {
  calcularStatusConciliacao, chaveBobina, chavesDaBobina, determinarFilial, formatarEnderecoSAP, limparCodigo,
  montarRelatorioConciliado, processarEntradaMassa as interpretarEntrada, removerZeros
} from './lib/inventario'
import './App.css'

// Períodos (dias) da conferência: leituras carregadas e bases SAP consideradas em "Pendentes SAP".
// As bases SAP são grandes (milhares de linhas por importação), por isso a janela delas é menor.
const PERIODOS_CONFERENCIA = [7, 30, 90, 180, 365];
const PERIODOS_PENDENTES = [1, 3, 7, 15, 30];

// sessionStorage tem cota (~5 MB). Uma planilha SAP grande não pode derrubar o app.
const salvarNaSessao = (chave, valor) => {
  try {
    if (valor === null || valor === undefined) sessionStorage.removeItem(chave);
    else sessionStorage.setItem(chave, valor);
  } catch (err) {
    console.warn(`[Sessão] Não foi possível salvar "${chave}" localmente (cota cheia?).`, err);
  }
};

const obterIniciais = (nome) => {
  if (!nome) return 'OP';
  const partes = nome.trim().split(/\s+/);
  if (partes.length >= 2) {
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }
  return partes[0].substring(0, 2).toUpperCase();
};

const dataIsoLocal = (d) => {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
};

const obterDataHojeIso = () => dataIsoLocal(new Date());

// Depósitos e rotas ficam em cache para o operador conseguir iniciar uma contagem sem rede
const lerCacheLocal = (chave) => {
  try { return JSON.parse(localStorage.getItem(chave) || 'null'); } catch { return null; }
};
const gravarCacheLocal = (chave, valor) => {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* cota cheia: segue sem cache */ }
};

function App() {
  // ESTADO DE ATUALIZAÇÃO DO PWA
  const [swRegistration, setSwRegistration] = useState(null);
  const [mostrarBannerAtualizacao, setMostrarBannerAtualizacao] = useState(false);

  // ESTADOS DE LOGIN E DADOS
  const [crachaLogado, setCrachaLogado] = useState(() => sessionStorage.getItem('usuario_cracha') || '');
  const [nomeLogado, setNomeLogado] = useState(() => sessionStorage.getItem('usuario_nome') || '');
  const [inputCracha, setInputCracha] = useState('');
  const [carregandoLogin, setCarregandoLogin] = useState(false);
  const [isAdmin, setIsAdmin] = useState(() => sessionStorage.getItem('usuario_is_admin') === 'true');
  // Setor/unidade do colaborador (cadastro do crachá). A contagem pertence ao colaborador;
  // a filial gravada em cada leitura é a da BOBINA, que pode ser de outra unidade.
  const [perfilLogado, setPerfilLogado] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('usuario_perfil') || 'null') || { setor: null, unidade: null }; } catch { return { setor: null, unidade: null }; }
  });
  const [leiturasGlobais, setLeiturasGlobais] = useState([]);
  const [depositosDisponiveis, setDepositosDisponiveis] = useState(() => lerCacheLocal('cache_depositos') || []);

  // OFFLINE-FIRST: hook de sincronização automática com IndexedDB
  const { isOnline, pendingCount, errorCount, syncNow, reenviarComErro } = useSyncManager();

  const aceitarAtualizacao = () => {
    if (swRegistration && swRegistration.waiting) {
      swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    setMostrarBannerAtualizacao(false);
  };

  
  // ESTADO ROTAS
  const [rotasDisponiveis, setRotasDisponiveis] = useState(() => lerCacheLocal('cache_rotas') || []);
  const [rotaAtual, setRotaAtual] = useState(''); 

  // ESTADOS DO FILTRO E PAGINAÇÃO
  const [conferenciaFilters, setConferenciaFilters] = useState({ lote: '', data_leitura: '', filial: '', deposito: '', operador: '', unidade_operador: '' });
  const [conferenciaSort] = useState({ field: 'Data', order: 'desc' });
  const [conferenciaStatusFilter, setConferenciaStatusFilter] = useState('todos');
  const [conferenciaTab, setConferenciaTab] = useState('inventarios'); // 'inventarios' | 'leituras' | 'faltando'
  const [bobinasFaltandoSap, setBobinasFaltandoSap] = useState([]);
  const [periodoConferencia, setPeriodoConferencia] = useState(30);
  const [periodoPendentes, setPeriodoPendentes] = useState(7);
  const [carregandoPendentes, setCarregandoPendentes] = useState(false);
  const [linhasBaseSapPeriodo, setLinhasBaseSapPeriodo] = useState(0);
  const cargaPendentesAtual = useRef(0);
  const [erroConferencia, setErroConferencia] = useState('');
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
    try { return JSON.parse(sessionStorage.getItem('csv_bobinas') || '[]'); } catch { return []; }
  })

  const [bobinasLidas, setBobinasLidas] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('lidas_bobinas') || '[]'); } catch { return []; }
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
  // Sessões já confirmadas no servidor nesta execução (evita uma consulta de rede a cada bipagem)
  const sessoesConfirmadas = useRef(new Set())

  const toggleLoteExpandido = (loteKey) => {
    setLotesExpandidos(prev => ({ ...prev, [loteKey]: !prev[loteKey] }));
  };

  useEffect(() => {
    const carregarDadosIniciais = async () => {
        try {
            const { data: deps, error: errDeps } = await supabase.from('depositos').select('*').order('id', { ascending: true });
            if (errDeps) throw errDeps;
            if (deps) {
              const lista = deps.map(d => ({ id: d.id, nome: d.nome, requerEndereco: d.requer_endereco }));
              setDepositosDisponiveis(lista);
              gravarCacheLocal('cache_depositos', lista);
            }

            const { data: rots, error: errRots } = await supabase.from('rotas').select('id, rota');
            if (errRots) throw errRots;
            if (rots) {
              setRotasDisponiveis(rots);
              gravarCacheLocal('cache_rotas', rots);
            }
        } catch (err) {
            console.error("Erro ao carregar dados iniciais:", err);
        }
    };
    carregarDadosIniciais();
  }, []);

  useEffect(() => {
    const lidarComAtualizacao = (event) => {
      console.log('Nova atualização do Service Worker detectada.');
      setSwRegistration(event.detail);
      setMostrarBannerAtualizacao(true);
    };

    window.addEventListener('pwa-update-available', lidarComAtualizacao);
    return () => {
      window.removeEventListener('pwa-update-available', lidarComAtualizacao);
    };
  }, []);

  useEffect(() => {
    salvarNaSessao('csv_bobinas', JSON.stringify(csvBobinas));
    salvarNaSessao('lidas_bobinas', JSON.stringify(bobinasLidas));
    salvarNaSessao('sessao_id', sessaoId || null);
    salvarNaSessao('tipo_contagem', tipoContagem || null);
  }, [csvBobinas, bobinasLidas, sessaoId, tipoContagem]);

  // Aparelho atualizado no meio de uma contagem iniciada sem rede (id "offline-<timestamp>"):
  // troca pelo uuid usado na fila, para exclusões e novas leituras usarem a mesma sessão
  useEffect(() => {
    if (sessaoId && String(sessaoId).startsWith('offline-')) {
      migrarSessaoLegada(sessaoId, crachaLogado).then(setSessaoId).catch(err => console.error(err));
    }
  }, [sessaoId, crachaLogado]);

  useEffect(() => {
    if (crachaLogado && nomeLogado) {
      sessionStorage.setItem('usuario_cracha', crachaLogado);
      sessionStorage.setItem('usuario_nome', nomeLogado);
      sessionStorage.setItem('usuario_is_admin', String(isAdmin));
      salvarNaSessao('usuario_perfil', JSON.stringify(perfilLogado));
    } else {
      sessionStorage.removeItem('usuario_cracha');
      sessionStorage.removeItem('usuario_nome');
      sessionStorage.removeItem('usuario_is_admin');
      sessionStorage.removeItem('usuario_perfil');
    }
  }, [crachaLogado, nomeLogado, isAdmin, perfilLogado]);

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
    const cracha = inputCracha.trim();
    const entrar = (dados) => {
      setCrachaLogado(cracha);
      setNomeLogado(dados.nome_completo || 'Operador');
      setIsAdmin(!!dados.admin);
      setPerfilLogado({ setor: dados.setor || null, unidade: dados.unidade ?? null });
    };
    // Crachás que já entraram neste aparelho: permite iniciar a contagem mesmo sem rede
    const cacheLogins = lerCacheLocal('cache_logins') || {};
    try {
      const { data, error } = await supabase.from('crachas').select('id, nome_completo, admin, setor, unidade').eq('id', cracha).maybeSingle().abortSignal(sinalTimeout(8000));
      if (data) {
        entrar(data);
        gravarCacheLocal('cache_logins', { ...cacheLogins, [cracha]: { nome_completo: data.nome_completo, admin: data.admin, setor: data.setor, unidade: data.unidade } });
      } else if (!error || ehErroPermanente(error)) {
        abrirAlerta('Acesso Negado', 'Crachá não encontrado.');
      } else if (cacheLogins[cracha]) {
        entrar(cacheLogins[cracha]);
      } else {
        abrirAlerta('Sem conexão', 'Não foi possível validar o crachá no servidor. Verifique a conexão e tente novamente.');
      }
    } catch (err) {
      console.error(err);
      abrirAlerta('Erro', 'Não foi possível conectar ao banco Supabase.');
    } finally { setCarregandoLogin(false); }
  }

  const fazerLogout = () => {
    abrirConfirmacao('Sair', 'Deseja sair? Seus dados continuarão na tela.', () => {
      setCrachaLogado(''); setNomeLogado(''); setInputCracha(''); setIsAdmin(false); setPerfilLogado({ setor: null, unidade: null });
    });
  }

  const garantirSessao = async () => {
    let idAtual = sessaoId;

    // Ids "offline-<timestamp>" de versões anteriores nunca seriam aceitos pelo banco (coluna uuid)
    if (idAtual && String(idAtual).startsWith('offline-')) {
      idAtual = await migrarSessaoLegada(idAtual, crachaLogado);
      setSessaoId(idAtual);
    }

    if (idAtual) {
      if (sessoesConfirmadas.current.has(idAtual) || !navigator.onLine || await sessaoPendenteLocal(idAtual)) {
        return idAtual;
      }
      const { data, error } = await supabase.from('sessoes_inventario').select('id').eq('id', idAtual).maybeSingle().abortSignal(sinalTimeout(5000));
      if (data) {
        sessoesConfirmadas.current.add(idAtual);
        return idAtual;
      }
      if (error) {
        // Rede instável: segue com a sessão local; a sincronização resolve depois
        console.warn("Falha ao verificar sessao, usando sessaoId local:", error.message);
        return idAtual;
      }
      // A sessão não existe mais no servidor: abre uma nova
    }

    // A sessão nasce no aparelho (uuid) e vai ao servidor na sincronização: funciona com ou sem rede
    const novoId = await registrarSessaoLocal(crachaLogado);
    setSessaoId(novoId);
    return novoId;
  }

  const limparValorParaBanco = (val) => (val === undefined || val === null || String(val).trim() === '') ? null : String(val).trim();
  // Colunas numéricas (double precision): valor inválido vira null em vez de rejeitar o lote inteiro
  const limparNumeroParaBanco = (val) => {
    if (val === undefined || val === null || String(val).trim() === '') return null;
    let formatado = String(val).trim();
    if (formatado.includes(',')) formatado = formatado.replace(/\./g, '').replace(',', '.');
    const numero = Number(formatado);
    return Number.isFinite(numero) ? numero : null;
  }
  // Colunas bigint (ex.: ordem_venda)
  const limparInteiroParaBanco = (val) => {
    const limpo = limparValorParaBanco(val);
    return limpo && /^\d+$/.test(limpo) ? limpo : null;
  }

  const enderecoSAP = (bobina) => formatarEnderecoSAP(bobina, depositosDisponiveis);

  // Planilha carregada neste aparelho, no formato de `bobinas_sap` (vale para a conferência mesmo
  // quando a importação não chegou ao servidor)
  const baseSapLocal = () => (csvBobinas || []).map(c => ({
    lote: c.lote || c.codigo, romaneio: c.romaneio, material: c.material, descricao: c.descricao,
    peso_liquido: c.peso_liquido, largura: c.largura, espessura: c.espessura, ordem_producao: c.ordem_producao,
    ordem_venda: c.ordem_venda, cliente: c.cliente, nome_cliente: c.nome_cliente, deposito: c.deposito,
    gondola: c.gondola, posicao: c.posicao, filial: c.filial, agrupador: c.agrupador,
  }));

  // CONFERÊNCIA: carrega as leituras do período (paginado, sem o teto de 10 mil linhas do Supabase)
  // e o SAP só das bobinas lidas (para o status de cada leitura). As pendências vêm depois, à parte.
  const carregarConferencia = async (dias = periodoConferencia) => {
    setCarregandoAcao(true);
    setErroConferencia('');
    try {
      const inicioPeriodo = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

      const [lidas, crachasList] = await Promise.all([
        buscarTodasPaginas(() => supabase.from('bobinas_lidas').select('*')
          .gte('data_leitura', inicioPeriodo)
          .order('data_leitura', { ascending: true }).order('id', { ascending: true })),
        buscarTodasPaginas(() => supabase.from('crachas').select('id, nome_completo, admin, setor, unidade').order('id', { ascending: true })),
      ]);

      const lotesLidos = lidas.flatMap(b => b.lote ? [b.lote, String(b.lote).toUpperCase()] : []);
      const sapDasLeituras = await buscarPorValores(lotes => supabase.from('bobinas_sap').select('*').in('lote', lotes).order('id', { ascending: true }), lotesLidos);

      // Data de cada importação: se o lote foi importado mais de uma vez, vale a mais recente
      const idsSessoesSap = [...new Set(sapDasLeituras.map(s => s.sessao_id).filter(Boolean))];
      const sessoesSap = await buscarPorValores(ids => supabase.from('sessoes_inventario').select('id, data_importacao').in('id', ids).order('id', { ascending: true }), idsSessoesSap, { tamanhoLote: 40 });
      const momentoPorSessao = new Map(sessoesSap.map(s => [s.id, new Date(s.data_importacao).getTime()]));

      const sapPorChave = new Map();
      sapDasLeituras.forEach(s => {
        const momento = momentoPorSessao.get(s.sessao_id) || 0;
        chavesDaBobina(s.lote, s.romaneio).forEach(k => {
          const atual = sapPorChave.get(k);
          if (!atual || momento >= atual._momento) sapPorChave.set(k, { ...s, _momento: momento });
        });
      });
      baseSapLocal().forEach(s => chavesDaBobina(s.lote, s.romaneio).forEach(k => {
        if (!sapPorChave.has(k)) sapPorChave.set(k, { ...s, _momento: 0 });
      }));

      const buscarSap = (b) => {
        if (b.romaneio) {
          const porRomaneio = sapPorChave.get(chaveBobina(null, b.romaneio));
          if (porRomaneio) return porRomaneio;
        }
        return b.lote ? sapPorChave.get(chaveBobina(b.lote, null)) : undefined;
      };

      const crachaMap = new Map();
      crachasList.forEach(c => crachaMap.set(String(c.id), c));
      const nomeRotaPorId = new Map(rotasDisponiveis.map(r => [String(r.id), r.rota]));

      const listaGlobal = lidas.map(b => {
        const cId = String(b.cracha_leitura || '');
        const dono = crachaMap.get(cId);
        const nomeDono = dono ? dono.nome_completo : (cId ? `Crachá ${cId}` : 'Não identificado');
        const dadosSap = buscarSap(b);

        const dataOriginal = b.data_leitura || b.created_at || b.data_hora || b.data_registro;
        let dataFormatada = '-';
        let dataIsoDia = '';
        let dataDiaFmt = '-';
        let horaFormatada = '-';
        let timestampNum = 0;

        if (dataOriginal) {
          const d = new Date(dataOriginal);
          if (!isNaN(d.getTime())) {
            timestampNum = d.getTime();
            dataIsoDia = dataIsoLocal(d);
            dataDiaFmt = dataIsoDia.split('-').reverse().join('/');
            horaFormatada = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            dataFormatada = `${dataDiaFmt} ${d.toLocaleTimeString('pt-BR')}`;
          } else {
            dataFormatada = String(dataOriginal);
          }
        }

        const filialFinal = b.filial || (dadosSap ? dadosSap.filial : null) || determinarFilial(b.lote) || '-';
        const nomeRota = nomeRotaPorId.get(String(b.rotas)) || b.rotas || '-';
        const { status, tipo } = calcularStatusConciliacao(b, dadosSap, nomeRota, depositosDisponiveis);

        return {
          id: b.id,
          // Mesma bobina lida mais de uma vez (outro aparelho, outro operador, após "Limpar tela")
          chave: chaveBobina(b.lote || b.romaneio, null),
          codigo: b.lote || b.romaneio,
          dataHora: dataFormatada,
          dataIso: dataIsoDia,
          dataDiaFmt: dataDiaFmt,
          horaFmt: horaFormatada,
          timestamp: timestampNum,
          sessao_id: b.sessao_id,
          cracha: b.cracha_leitura,
          nome: nomeDono,
          // Unidade/setor de quem contou (cadastro do crachá) — independente da filial da bobina
          unidadeOperador: dono && dono.unidade != null ? String(dono.unidade) : '-',
          setorOperador: dono?.setor || '-',
          lote: b.lote,
          romaneio: b.romaneio,
          filial: filialFinal,
          deposito: b.deposito || (dadosSap ? (dadosSap.deposito || '-') : '-'),
          endereco_lido: b.endereco_lido || '-',
          endereco_sap: enderecoSAP(dadosSap),
          agrupador: dadosSap ? (dadosSap.agrupador || '-') : '-',
          material: dadosSap ? (dadosSap.material || '-') : '-',
          descricao: dadosSap ? (dadosSap.descricao || '-') : '-',
          peso_liquido: dadosSap ? (dadosSap.peso_liquido || '-') : '-',
          largura: dadosSap ? (dadosSap.largura || '-') : '-',
          espessura: dadosSap ? (dadosSap.espessura || '-') : '-',
          ordem_producao: dadosSap ? (dadosSap.ordem_producao || '-') : '-',
          ordem_venda: dadosSap ? (dadosSap.ordem_venda || '-') : '-',
          cliente: dadosSap ? (dadosSap.cliente || '-') : '-',
          nome_cliente: dadosSap ? (dadosSap.nome_cliente || '-') : '-',
          rota: nomeRota,
          status,
          tipo
        };
      });

      setLeiturasGlobais(listaGlobal);
      // Pendências em segundo plano: a tabela de leituras já pode ser usada
      carregarPendentes(periodoPendentes, listaGlobal);
    } catch (err) {
      console.error(err);
      setErroConferencia(`Não foi possível carregar a conferência: ${err?.message || err}`);
    } finally {
      setCarregandoAcao(false);
    }
  };

  // PENDENTES SAP: bobinas das bases importadas no período que ninguém bipou.
  // Uma base pode ter milhares de linhas e o mesmo lote costuma ser importado várias vezes,
  // então a janela é curta e repetições entre bases diferentes são descartadas.
  const carregarPendentes = async (diasBase = periodoPendentes, leituras = leiturasGlobais) => {
    const carga = ++cargaPendentesAtual.current;
    setCarregandoPendentes(true);
    try {
      const inicio = new Date(Date.now() - diasBase * 24 * 60 * 60 * 1000).toISOString();
      const sessoes = await buscarTodasPaginas(() => supabase.from('sessoes_inventario').select('id, data_importacao, cracha_importacao')
        .gte('data_importacao', inicio).order('id', { ascending: true }));
      const sapDoPeriodo = await buscarPorValores(ids => supabase.from('bobinas_sap').select('*').in('sessao_id', ids).order('id', { ascending: true }), sessoes.map(s => s.id), { tamanhoLote: 40 });
      if (carga !== cargaPendentesAtual.current) return; // o usuário já pediu outra janela

      const sapLocal = baseSapLocal();
      setLinhasBaseSapPeriodo(sapDoPeriodo.length + sapLocal.length);
      const sessaoPorId = new Map(sessoes.map(s => [s.id, s]));
      const chavesLidas = new Set(leituras.flatMap(l => chavesDaBobina(l.lote, l.romaneio)));
      const momentoDe = (s) => {
        const sessao = sessaoPorId.get(s.sessao_id);
        return sessao ? new Date(sessao.data_importacao).getTime() : 0;
      };

      // O mesmo lote/romaneio importado em várias bases conta só pela importação mais recente.
      // Dentro dessa base, TODAS as linhas continuam (ex.: as várias linhas de um romaneio),
      // exatamente como a planilha veio.
      const baseMaisRecente = new Map();
      sapDoPeriodo.forEach(s => {
        const chave = chavesDaBobina(s.lote, s.romaneio)[0];
        if (!chave) return;
        const momento = momentoDe(s);
        const atual = baseMaisRecente.get(chave);
        if (!atual || momento > atual.momento) baseMaisRecente.set(chave, { momento, sessaoId: s.sessao_id });
      });

      const montarPendente = (s, momento) => {
        const dataImport = momento ? new Date(momento) : new Date();
        return {
          chave: chavesDaBobina(s.lote, s.romaneio)[0],
          codigo: s.lote || s.romaneio,
          dataHora: '-',
          dataIso: '',
          dataDiaFmt: '-',
          dataImportIso: dataIsoLocal(dataImport),
          timestampImport: dataImport.getTime(),
          cracha: '-',
          nome: '-',
          lote: s.lote,
          romaneio: s.romaneio,
          filial: s.filial || determinarFilial(s.lote) || '-',
          deposito: s.deposito || '-',
          endereco_lido: '-',
          endereco_sap: enderecoSAP(s),
          agrupador: s.agrupador || '-',
          material: s.material || '-',
          descricao: s.descricao || '-',
          peso_liquido: s.peso_liquido || '-',
          largura: s.largura || '-',
          espessura: s.espessura || '-',
          ordem_producao: s.ordem_producao || '-',
          ordem_venda: s.ordem_venda || '-',
          cliente: s.cliente || '-',
          nome_cliente: s.nome_cliente || '-',
          rota: '-',
          status: 'Faltando (Não Bipada)',
          tipo: 'faltando'
        };
      };
      const foiLida = (s) => chavesDaBobina(s.lote, s.romaneio).some(k => chavesLidas.has(k));

      const pendentes = sapDoPeriodo
        .filter(s => {
          const chave = chavesDaBobina(s.lote, s.romaneio)[0];
          return chave && !foiLida(s) && baseMaisRecente.get(chave)?.sessaoId === s.sessao_id;
        })
        .map(s => montarPendente(s, momentoDe(s)));
      // Planilha deste aparelho: só o que não veio do servidor (ex.: importação que não foi salva)
      sapLocal
        .filter(s => {
          const chave = chavesDaBobina(s.lote, s.romaneio)[0];
          return chave && !foiLida(s) && !baseMaisRecente.has(chave);
        })
        .forEach(s => pendentes.push(montarPendente(s, null)));

      setBobinasFaltandoSap(pendentes.sort((a, b) => b.timestampImport - a.timestampImport));
    } catch (err) {
      console.error(err);
      if (carga === cargaPendentesAtual.current) setErroConferencia(`Não foi possível carregar as pendências SAP: ${err?.message || err}`);
    } finally {
      if (carga === cargaPendentesAtual.current) setCarregandoPendentes(false);
    }
  };

  const abrirConferenciaAdmin = async () => {
    setShowConferencia(true);
    setPaginaAtual(1);
    setConferenciaStatusFilter('todos');
    const hojeIso = obterDataHojeIso();

    if (!isAdmin) {
      setConferenciaTab('leituras');
      setConferenciaFilters({ lote: '', data_leitura: hojeIso, filial: '', deposito: '', operador: String(crachaLogado), unidade_operador: '' });
    } else {
      setConferenciaTab('inventarios');
      setConferenciaFilters({ lote: '', data_leitura: '', filial: '', deposito: '', operador: '', unidade_operador: '' });
    }
    await carregarConferencia(periodoConferencia);
  };

  const alterarPeriodoConferencia = (dias) => {
    setPeriodoConferencia(dias);
    setPaginaAtual(1);
    carregarConferencia(dias);
  };

  const alterarPeriodoPendentes = (dias) => {
    setPeriodoPendentes(dias);
    setPaginaAtual(1);
    carregarPendentes(dias);
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
        ordem_venda: limparInteiroParaBanco(item.ordem_venda),
        agrupador: limparValorParaBanco(item.agrupador),
        largura: limparNumeroParaBanco(item.largura),
        espessura: limparNumeroParaBanco(item.espessura),
        deposito: limparValorParaBanco(item.deposito),
        gondola: limparValorParaBanco(item.gondola),
        filial: limparValorParaBanco(item.filial)
      }));

      // A planilha vale neste aparelho mesmo se o servidor falhar; o operador precisa saber se ela
      // chegou ao banco, porque a conferência dos administradores depende disso.
      setCsvBobinas(codigosExtraidos);
      const resumoImportacao = `${codigosExtraidos.length} itens processados como ${modoEscolhido === 'ROMANEIO' ? 'Romaneio' : 'Lote'}`;

      let falhaServidor = null;
      if (!navigator.onLine) {
        falhaServidor = 'sem conexão';
      } else {
        const sessoes = await enviarSessoesPendentes();
        if (!sessoes.ok) {
          falhaServidor = sessoes.error?.message || 'não foi possível registrar a sessão';
        } else {
          const resultado = await salvarBaseSap(dadosParaBanco);
          if (resultado.colunasIgnoradas.length > 0) {
            console.warn(`[SAP] Colunas ainda não criadas no banco e ignoradas: ${resultado.colunasIgnoradas.join(', ')}`);
          }
          if (resultado.error) {
            console.error('Erro ao salvar base SAP:', resultado.error);
            falhaServidor = `${resultado.salvas} de ${resultado.total} salvos — ${resultado.error.message || resultado.error.code}`;
          }
        }
      }

      if (falhaServidor) {
        abrirAlerta('Planilha carregada só neste aparelho', `${resumoImportacao}.

A base SAP NÃO foi salva no servidor (${falhaServidor}). A contagem neste aparelho funciona normalmente, mas a Conferência dos administradores não terá esta base. Importe de novo quando houver conexão.`);
      } else {
        abrirAlerta('Sucesso', `Planilha importada! (${resumoImportacao})`);
      }

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

  // Regras de interpretação dos códigos em src/lib/inventario.js
  const processarEntradaMassa = (textoEntrada) => interpretarEntrada(textoEntrada, tipoContagem, csvBobinas);

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

        // Filial do SAP tem prioridade: determinarFilial() sempre devolve algo (padrão 1001 - Videira)
        const filialMapeada = (bobinaSAP ? bobinaSAP.filial : null) || determinarFilial(identificadorFinal);
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
            insercoesNoBanco.map(i => ({ ...i, uuid: gerarUuid(), _status: 'pendente', _criado_em: agora }))
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
    if (!arrayDeTextosLidos || arrayDeTextosLidos.length === 0) { abrirAlerta('Resultado', 'Nenhum código lido.'); return; }

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
          enderecoAInserir = `Depósito: ${depositoAtual}${gondolaAtual.trim() ? ` | G: ${gondolaAtual}` : ''} | P: ${gavetaAtual}`;
        } else {
          enderecoAInserir = `Depósito: ${depositoAtual}`;
        }
      }

      for (const lote of lotesFormatados) {
        if (!lote) continue;
        
        const bobinaSAP = csvBobinas.find(c => {
          if (tipoContagem === 'ROMANEIO') {
            return limparCodigo(c.romaneio) === lote;
          } else {
            return limparCodigo(c.codigo) === lote;
          }
        });
        const identificadorFinal = bobinaSAP ? bobinaSAP.codigo : lote;

        if (listaAtualizada.some(b => b.codigo === identificadorFinal)) continue;
        
        const filialMapeada = (bobinaSAP ? bobinaSAP.filial : null) || determinarFilial(identificadorFinal);
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
          insercoesNoBanco.map(i => ({ ...i, uuid: gerarUuid(), _status: 'pendente', _criado_em: agora }))
        );
        syncNow();
      }
      setBobinasLidas(listaAtualizada);
      abrirAlerta('Missão do Drone Concluída!', `Processados e inseridos ${insercoesNoBanco.length} novos itens no inventário.`);
    } catch (erro) { console.error(erro); abrirAlerta('Erro', 'Ocorreu um problema ao salvar os dados do drone.'); } finally { setCarregandoAcao(false); }
  };

  const removerBobina = async (codigoParaRemover) => {
    setCarregandoAcao(true);
    try {
      // Espera um envio em andamento terminar; senão a leitura poderia chegar ao servidor depois de excluída
      await aguardarSincronizacao();
      const registrosLocais = await db.leituras_pendentes
        .where('lote').equals(codigoParaRemover)
        .and(item => item.sessao_id === sessaoId)
        .toArray();
      const jaEnviada = registrosLocais.length === 0 || registrosLocais.some(r => r._status === 'sincronizado');

      if (jaEnviada && !navigator.onLine) {
        abrirAlerta('Sem conexão', `A leitura ${codigoParaRemover} já foi enviada ao servidor. Conecte-se à rede para excluí-la.`);
        return;
      }
      if (jaEnviada && sessaoId) {
        const { error } = await supabase.from('bobinas_lidas').delete().eq('sessao_id', sessaoId).eq('lote', codigoParaRemover).abortSignal(sinalTimeout());
        if (error) throw error;
      }
      await db.leituras_pendentes.bulkDelete(registrosLocais.map(r => r.id));
      setBobinasLidas(prev => prev.filter(b => b.codigo !== codigoParaRemover));
    } catch (erro) {
      console.error(erro);
      abrirAlerta('Erro', 'Falha ao excluir. Verifique a conexão e tente novamente.');
    } finally { setCarregandoAcao(false); }
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

  // AUDITORIA E RELATÓRIO COM VALIDAÇÃO INTELIGENTE (regras em src/lib/inventario.js)
  // Memorizado: antes era recalculado a cada tecla digitada no campo de leitura.
  const relatorioNaTela = useMemo(() => montarRelatorioConciliado({
    bobinasLidas, csvBobinas, rotas: rotasDisponiveis, depositos: depositosDisponiveis
  }), [bobinasLidas, csvBobinas, rotasDisponiveis, depositosDisponiveis]);

  const gerarRelatorio = () => {
    const dados = relatorioNaTela;
    if (dados.length === 0) { abrirAlerta('Vazio', 'Sem dados para gerar relatório.'); return; }
    const cabecalho = 'Lote/Posicao;Romaneio;Material;Descricao;Filial;Deposito;Endereco Lido;Endereco SAP;Peso Liquido;Status;Rota;Data e Hora Leitura;Operador;Cracha';
    const linhas = dados.map(e => [
      e.lote, e.romaneio, e.material, e.descricao, e.filial, e.deposito, e.endereco_lido, e.endereco_sap,
      e.peso_liquido, e.status, e.rota, e.dataHora, e.nome_operador, e.cracha
    ].map(campoCSV).join(';'));
    baixarCSV(`relatorio_inventario_${new Date().getTime()}.csv`, cabecalho, linhas);
  }

  // Contadores com a regra original (Esperadas = linhas da planilha). O Set só evita
  // percorrer a planilha inteira para cada bobina lida a cada renderização.
  const codigosEsperados = useMemo(() => new Set(csvBobinas.map(c => c.codigo)), [csvBobinas]);
  const qtdLidas = bobinasLidas.length; const qtdEsperadas = csvBobinas.length;
  const qtdFaltam = Math.max(0, qtdEsperadas - bobinasLidas.filter(b => codigosEsperados.has(b.codigo)).length);

  // LISTA DE DATAS ÚNICAS DOS INVENTÁRIOS (ORDENADAS DA MAIS RECENTE PARA A MAIS ANTIGA)
  const listaDatasInventarios = useMemo(() => {
    const mapaDatas = new Map();
    leiturasGlobais.forEach(l => {
      if (l.dataIso && !mapaDatas.has(l.dataIso)) {
        mapaDatas.set(l.dataIso, { dataIso: l.dataIso, dataFmt: l.dataDiaFmt, timestamp: l.timestamp });
      }
    });
    return Array.from(mapaDatas.values()).sort((a, b) => b.timestamp - a.timestamp);
  }, [leiturasGlobais]);

  // UNIDADES DOS COLABORADORES QUE FIZERAM LEITURAS (filtro da conferência)
  const listaUnidadesOperadores = useMemo(() => {
    const unidades = new Set(leiturasGlobais.map(l => l.unidadeOperador).filter(u => u && u !== '-'));
    return Array.from(unidades).sort();
  }, [leiturasGlobais]);

  // LISTA DE OPERADORES ÚNICOS NAS LEITURAS
  const listaOperadores = useMemo(() => {
    const map = new Map();
    leiturasGlobais.forEach(l => {
      const crachaStr = String(l.cracha || '');
      if (crachaStr && crachaStr !== '-' && !map.has(crachaStr)) {
        map.set(crachaStr, { cracha: crachaStr, nome: l.nome });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [leiturasGlobais]);

  // RESUMO DE INVENTÁRIOS REALIZADOS (CADA INVENTÁRIO É DEFINIDO POR DATA + COLABORADOR COM SUA PRÓPRIA KPI)
  // A mesma bobina lida mais de uma vez no mesmo inventário conta uma vez só (as demais são "repetidas").
  const resumoInventarios = useMemo(() => {
    const mapa = {};
    [...leiturasGlobais].sort((a, b) => a.timestamp - b.timestamp).forEach(l => {
      const dataIso = l.dataIso || 'sem_data';
      const cracha = String(l.cracha || 'sem_cracha');
      const chave = `${dataIso}___${cracha}`;

      if (!mapa[chave]) {
        mapa[chave] = {
          id: chave,
          dataIso: dataIso,
          dataFmt: l.dataDiaFmt || '-',
          cracha: l.cracha,
          nome: l.nome,
          unidadeOperador: l.unidadeOperador,
          setorOperador: l.setorOperador,
          total: 0,
          ok: 0,
          sobrando: 0,
          divergencia: 0,
          repetidas: 0,
          bobinas: new Set(),
          depositos: new Set(),
          primeiroTimestamp: l.timestamp || 0,
          ultimoTimestamp: l.timestamp || 0,
          primeiraHora: l.horaFmt || '-',
          ultimaHora: l.horaFmt || '-'
        };
      }

      const inv = mapa[chave];
      if (inv.bobinas.has(l.chave)) {
        inv.repetidas++;
      } else {
        inv.bobinas.add(l.chave);
        inv.total++;
        if (l.tipo === 'ok') inv.ok++;
        else if (l.tipo === 'sobrando') inv.sobrando++;
        else if (l.tipo === 'divergencia') inv.divergencia++;
      }
      if (l.deposito && l.deposito !== '-') inv.depositos.add(l.deposito);

      if (l.timestamp && (!inv.primeiroTimestamp || l.timestamp < inv.primeiroTimestamp)) {
        inv.primeiroTimestamp = l.timestamp;
        inv.primeiraHora = l.horaFmt;
      }
      if (l.timestamp && (!inv.ultimoTimestamp || l.timestamp > inv.ultimoTimestamp)) {
        inv.ultimoTimestamp = l.timestamp;
        inv.ultimaHora = l.horaFmt;
      }
    });

    return Object.values(mapa).sort((a, b) => b.ultimoTimestamp - a.ultimoTimestamp);
  }, [leiturasGlobais]);

  // INVENTÁRIOS FILTRADOS POR OPERADOR, DATA OU DEPÓSITO
  const inventariosFiltrados = useMemo(() => {
    return resumoInventarios.filter(inv => {
      if (conferenciaFilters.operador && String(inv.cracha) !== String(conferenciaFilters.operador)) return false;
      if (conferenciaFilters.unidade_operador && inv.unidadeOperador !== conferenciaFilters.unidade_operador) return false;
      if (conferenciaFilters.data_leitura && inv.dataIso !== conferenciaFilters.data_leitura) return false;
      if (conferenciaFilters.deposito && !inv.depositos.has(conferenciaFilters.deposito)) return false;
      return true;
    });
  }, [resumoInventarios, conferenciaFilters]);

  // FILTRA ITENS CONTADOS NO CONTEXTO ATIVO (OPERADOR, DATA DO INVENTÁRIO, DEPÓSITO, FILIAL, BUSCA)
  // Sem filtrar por status, para que os cartões de KPI mostrem o resumo exato daquele inventário/contexto.
  // Leituras da mesma bobina dentro do contexto: a primeira vale, as seguintes são marcadas como repetidas.
  const itensNoContexto = useMemo(() => {
    const filtradas = leiturasGlobais.filter(l => {
      if (conferenciaFilters.operador && String(l.cracha) !== String(conferenciaFilters.operador)) return false;
      if (conferenciaFilters.unidade_operador && l.unidadeOperador !== conferenciaFilters.unidade_operador) return false;
      if (conferenciaFilters.data_leitura && l.dataIso !== conferenciaFilters.data_leitura) return false;
      if (conferenciaFilters.deposito && l.deposito !== conferenciaFilters.deposito) return false;
      if (conferenciaFilters.filial && l.filial !== conferenciaFilters.filial) return false;
      const termoBusca = conferenciaFilters.lote.trim().toLowerCase();
      if (termoBusca) {
        const cod = String(l.codigo || '').toLowerCase();
        const rom = String(l.romaneio || '').toLowerCase();
        const desc = String(l.descricao || '').toLowerCase();
        const mat = String(l.material || '').toLowerCase();
        if (!cod.includes(termoBusca) && !rom.includes(termoBusca) && !desc.includes(termoBusca) && !mat.includes(termoBusca)) return false;
      }
      return true;
    });

    const vistas = new Set();
    return filtradas.sort((a, b) => a.timestamp - b.timestamp).map(l => {
      const repetida = vistas.has(l.chave);
      vistas.add(l.chave);
      return { ...l, repetida };
    });
  }, [leiturasGlobais, conferenciaFilters]);

  // BOBINAS PENDENTES NO SAP NO CONTEXTO (DEPÓSITO, FILIAL, BUSCA)
  // A lista já chega sem repetições entre bases (vale a importação mais recente de cada lote).
  const faltandoNoContexto = useMemo(() => {
    return bobinasFaltandoSap.filter(f => {
      if (conferenciaFilters.deposito && f.deposito !== conferenciaFilters.deposito) return false;
      if (conferenciaFilters.filial && f.filial !== conferenciaFilters.filial) return false;
      const termoBusca = conferenciaFilters.lote.trim().toLowerCase();
      if (termoBusca) {
        const cod = String(f.codigo || '').toLowerCase();
        const rom = String(f.romaneio || '').toLowerCase();
        const desc = String(f.descricao || '').toLowerCase();
        const mat = String(f.material || '').toLowerCase();
        if (!cod.includes(termoBusca) && !rom.includes(termoBusca) && !desc.includes(termoBusca) && !mat.includes(termoBusca)) return false;
      }
      return true;
    });
  }, [bobinasFaltandoSap, conferenciaFilters]);

  // KPIS DINÂMICOS: CALCULADOS COM BASE NO INVENTÁRIO/CONTEXTO ATIVO (COLABORADOR / DATA / DEPÓSITO)
  const kpiConferencia = useMemo(() => {
    const unicas = itensNoContexto.filter(l => !l.repetida);
    return {
      total: unicas.length,
      repetidas: itensNoContexto.length - unicas.length,
      ok: unicas.filter(l => l.tipo === 'ok').length,
      sobrando: unicas.filter(l => l.tipo === 'sobrando').length,
      divergencia: unicas.filter(l => l.tipo === 'divergencia').length,
      faltando: faltandoNoContexto.length,
    };
  }, [itensNoContexto, faltandoNoContexto]);

  // LEITURAS PROCESSADAS (COM FILTRO DE STATUS SELECIONADO E ORDENAÇÃO)
  const leiturasProcessadas = useMemo(() => {
    const filtradas = itensNoContexto.filter(l => {
      if (conferenciaStatusFilter !== 'todos' && l.tipo !== conferenciaStatusFilter) return false;
      return true;
    });

    return filtradas.sort((a, b) => {
      if (conferenciaSort.field === 'Lote') {
        const cmp = String(a.codigo || '').localeCompare(String(b.codigo || ''));
        return conferenciaSort.order === 'asc' ? cmp : -cmp;
      }
      if (conferenciaSort.field === 'Data') {
        return conferenciaSort.order === 'asc' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp;
      }
      return 0;
    });
  }, [itensNoContexto, conferenciaStatusFilter, conferenciaSort]);

  // PAGINAÇÃO DINÂMICA
  const totalItensAba = conferenciaTab === 'faltando'
    ? faltandoNoContexto.length
    : (conferenciaTab === 'inventarios' ? inventariosFiltrados.length : leiturasProcessadas.length);
  const totalPaginas = Math.ceil(totalItensAba / ITENS_POR_PAGINA) || 1;
  const paginaCorrigida = Math.min(paginaAtual, totalPaginas);
  const leiturasPaginadas = leiturasProcessadas.slice((paginaCorrigida - 1) * ITENS_POR_PAGINA, paginaCorrigida * ITENS_POR_PAGINA);
  const faltandoPaginadas = faltandoNoContexto.slice((paginaCorrigida - 1) * ITENS_POR_PAGINA, paginaCorrigida * ITENS_POR_PAGINA);
  const inventariosPaginados = inventariosFiltrados.slice((paginaCorrigida - 1) * ITENS_POR_PAGINA, paginaCorrigida * ITENS_POR_PAGINA);

  // EXPORTAR CONFERÊNCIA EM CSV CONFORME A ABA ATIVA
  const exportarConferencia = () => {
    const agora = new Date().getTime();

    if (conferenciaTab === 'inventarios') {
      if (inventariosFiltrados.length === 0) { abrirAlerta('Vazio', 'Sem dados de inventários para exportar.'); return; }
      const cabecalho = 'Data do Inventario;Horario;Colaborador;Cracha;Total Contado;OK (No SAP);Sobra (Nao SAP);Local Incorreto;Acuracia;Depositos;Unidade Colaborador;Setor Colaborador';
      const linhas = inventariosFiltrados.map(c => {
        const taxa = c.total > 0 ? ((c.ok / c.total) * 100).toFixed(1) + '%' : '0%';
        const horario = `${c.primeiraHora} as ${c.ultimaHora}`;
        return [campoCSV(c.dataFmt), campoCSV(horario), campoCSV(c.nome), campoCSV(c.cracha), c.total, c.ok, c.sobrando, c.divergencia, taxa, campoCSV(Array.from(c.depositos).join(', ')), campoCSV(c.unidadeOperador), campoCSV(c.setorOperador)].join(';');
      });
      baixarCSV(`resumo_inventarios_${agora}.csv`, cabecalho, linhas);
      return;
    }

    if (conferenciaTab === 'faltando') {
      if (faltandoNoContexto.length === 0) { abrirAlerta('Vazio', 'Sem bobinas pendentes para exportar.'); return; }
      const cabecalho = 'Lote;Romaneio;Material;Descricao;Filial;Deposito;Endereco SAP;Peso Liquido;Status';
      const linhas = faltandoNoContexto.map(e => [e.lote, e.romaneio, e.material, e.descricao, e.filial, e.deposito, e.endereco_sap, e.peso_liquido, e.status].map(campoCSV).join(';'));
      baixarCSV(`bobinas_pendentes_sap_${agora}.csv`, cabecalho, linhas);
      return;
    }

    // Default: aba leituras
    if (leiturasProcessadas.length === 0) { abrirAlerta('Vazio', 'Sem dados para exportar.'); return; }
    const cabecalho = 'Lote;Romaneio;Material;Descricao;Filial;Deposito;Endereco Lido;Endereco SAP;Peso Liquido;Status;Rota;Data Leitura;Operador;Cracha;Unidade Colaborador;Setor Colaborador';
    const linhas = leiturasProcessadas.map(e => [
      e.lote, e.romaneio, e.material, e.descricao, e.filial, e.deposito, e.endereco_lido, e.endereco_sap, e.peso_liquido,
      e.repetida ? `${e.status} (Repetida)` : e.status, e.rota, e.dataHora, e.nome, e.cracha, e.unidadeOperador, e.setorOperador
    ].map(campoCSV).join(';'));
    baixarCSV(`conferencia_leituras_${agora}.csv`, cabecalho, linhas);
  };

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
          <div className="modal-dialog modal-dialog-centered modal-xl mx-2 mx-sm-auto" style={{ maxWidth: '1140px' }}>
            <div className="modal-content shadow border-0" style={{ borderRadius: '14px', overflow: 'hidden' }}>
              {/* Header */}
              <div className="modal-header border-0 text-white" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', padding: '1rem 1.5rem' }}>
                <div className="d-flex align-items-center gap-3 flex-wrap">
                  <div className="d-flex align-items-center gap-2">
                    <i className="bi bi-clipboard2-data-fill text-primary fs-4"></i>
                    <h5 className="modal-title fw-bold fs-5 text-white mb-0">Painel de Conferência</h5>
                  </div>
                  {conferenciaFilters.operador ? (
                    <span className="badge bg-primary bg-opacity-25 text-info border border-info border-opacity-25 px-3 py-1 rounded-pill" style={{ fontSize: '0.8rem' }}>
                      <i className="bi bi-person-fill me-1"></i>
                      {listaOperadores.find(o => String(o.cracha) === String(conferenciaFilters.operador))?.nome || `Crachá ${conferenciaFilters.operador}`}
                    </span>
                  ) : (
                    <span className="badge bg-secondary bg-opacity-25 text-light border border-secondary border-opacity-25 px-3 py-1 rounded-pill" style={{ fontSize: '0.8rem' }}>
                      <i className="bi bi-calendar3 me-1"></i> Todos os Inventários
                    </span>
                  )}
                  {carregandoAcao && <span className="spinner-border spinner-border-sm text-light" role="status"></span>}
                </div>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowConferencia(false)}></button>
              </div>

              {/* Abas de Navegação */}
              <div className="px-3 pt-2 bg-light d-flex gap-2 border-bottom flex-wrap" style={{ backgroundColor: '#f1f5f9' }}>
                <button
                  className={`btn btn-sm d-flex align-items-center gap-1 rounded-top-2 border-bottom-0 fw-semibold ${conferenciaTab === 'inventarios' ? 'btn-white bg-white text-dark shadow-sm border' : 'btn-ghost text-muted'}`}
                  style={{ padding: '0.5rem 1rem', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
                  onClick={() => { setConferenciaTab('inventarios'); setPaginaAtual(1); }}
                >
                  <i className="bi bi-calendar-check-fill text-primary"></i> {isAdmin ? 'Inventários Realizados' : 'Meus Inventários'} ({inventariosFiltrados.length})
                </button>
                <button
                  className={`btn btn-sm d-flex align-items-center gap-1 rounded-top-2 border-bottom-0 fw-semibold ${conferenciaTab === 'leituras' ? 'btn-white bg-white text-dark shadow-sm border' : 'btn-ghost text-muted'}`}
                  style={{ padding: '0.5rem 1rem', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
                  onClick={() => { setConferenciaTab('leituras'); setPaginaAtual(1); }}
                >
                  <i className="bi bi-box-seam-fill text-success"></i> Bobinas Bipadas ({itensNoContexto.length})
                </button>
                <button
                  className={`btn btn-sm d-flex align-items-center gap-1 rounded-top-2 border-bottom-0 fw-semibold ${conferenciaTab === 'faltando' ? 'btn-white bg-white text-dark shadow-sm border' : 'btn-ghost text-muted'}`}
                  style={{ padding: '0.5rem 1rem', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
                  onClick={() => { setConferenciaTab('faltando'); setPaginaAtual(1); }}
                >
                  <i className="bi bi-exclamation-triangle-fill text-warning"></i> Pendentes SAP ({faltandoNoContexto.length})
                </button>
              </div>

              <div className="modal-body p-0">
                {/* 5 KPI Cards Interativos */}
                <div className="p-3" style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <div className="row g-2">
                    <div className="col-6 col-md">
                      <button
                        onClick={() => { setConferenciaTab('leituras'); setConferenciaStatusFilter('todos'); setPaginaAtual(1); }}
                        className={`w-100 border-0 rounded-3 p-2 text-start ${conferenciaTab === 'leituras' && conferenciaStatusFilter === 'todos' ? 'shadow' : ''}`}
                        style={{ background: conferenciaTab === 'leituras' && conferenciaStatusFilter === 'todos' ? '#1e293b' : '#fff', cursor: 'pointer', transition: 'all 0.2s', border: '1px solid #e2e8f0' }}
                        title="Ver todas as bobinas bipadas neste filtro"
                      >
                        <div className="fw-bold" style={{ fontSize: '1.35rem', color: conferenciaTab === 'leituras' && conferenciaStatusFilter === 'todos' ? '#fff' : '#1e293b' }}>
                          {kpiConferencia.total}
                        </div>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: conferenciaTab === 'leituras' && conferenciaStatusFilter === 'todos' ? '#94a3b8' : '#64748b' }}>
                          Total Contado
                        </div>
                        {kpiConferencia.repetidas > 0 && (
                          <div style={{ fontSize: '0.65rem', color: conferenciaTab === 'leituras' && conferenciaStatusFilter === 'todos' ? '#cbd5e1' : '#94a3b8' }} title="Leituras repetidas da mesma bobina não entram nos totais">
                            +{kpiConferencia.repetidas} leitura(s) repetida(s)
                          </div>
                        )}
                      </button>
                    </div>
                    <div className="col-6 col-md">
                      <button
                        onClick={() => { setConferenciaTab('leituras'); setConferenciaStatusFilter('ok'); setPaginaAtual(1); }}
                        className={`w-100 border-0 rounded-3 p-2 text-start ${conferenciaTab === 'leituras' && conferenciaStatusFilter === 'ok' ? 'shadow' : ''}`}
                        style={{ background: conferenciaTab === 'leituras' && conferenciaStatusFilter === 'ok' ? '#15803d' : '#f0fdf4', cursor: 'pointer', transition: 'all 0.2s', borderLeft: '3px solid #22c55e', border: '1px solid #dcfce7' }}
                        title="Ver bobinas confirmadas no SAP"
                      >
                        <div className="fw-bold" style={{ fontSize: '1.35rem', color: conferenciaTab === 'leituras' && conferenciaStatusFilter === 'ok' ? '#fff' : '#15803d' }}>
                          {kpiConferencia.ok}
                        </div>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: conferenciaTab === 'leituras' && conferenciaStatusFilter === 'ok' ? '#bbf7d0' : '#15803d' }}>
                          <i className="bi bi-check-circle-fill me-1"></i>OK / Encontrado
                        </div>
                      </button>
                    </div>
                    <div className="col-6 col-md">
                      <button
                        onClick={() => { setConferenciaTab('leituras'); setConferenciaStatusFilter('sobrando'); setPaginaAtual(1); }}
                        className={`w-100 border-0 rounded-3 p-2 text-start ${conferenciaTab === 'leituras' && conferenciaStatusFilter === 'sobrando' ? 'shadow' : ''}`}
                        style={{ background: conferenciaTab === 'leituras' && conferenciaStatusFilter === 'sobrando' ? '#7c3aed' : '#faf5ff', cursor: 'pointer', transition: 'all 0.2s', borderLeft: '3px solid #8b5cf6', border: '1px solid #f3e8ff' }}
                        title="Ver bobinas que não constavam no SAP"
                      >
                        <div className="fw-bold" style={{ fontSize: '1.35rem', color: conferenciaTab === 'leituras' && conferenciaStatusFilter === 'sobrando' ? '#fff' : '#7c3aed' }}>
                          {kpiConferencia.sobrando}
                        </div>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: conferenciaTab === 'leituras' && conferenciaStatusFilter === 'sobrando' ? '#ddd6fe' : '#7c3aed' }}>
                          <i className="bi bi-plus-circle-fill me-1"></i>Sobra (Não SAP)
                        </div>
                      </button>
                    </div>
                    <div className="col-6 col-md">
                      <button
                        onClick={() => { setConferenciaTab('leituras'); setConferenciaStatusFilter('divergencia'); setPaginaAtual(1); }}
                        className={`w-100 border-0 rounded-3 p-2 text-start ${conferenciaTab === 'leituras' && conferenciaStatusFilter === 'divergencia' ? 'shadow' : ''}`}
                        style={{ background: conferenciaTab === 'leituras' && conferenciaStatusFilter === 'divergencia' ? '#b91c1c' : '#fff1f2', cursor: 'pointer', transition: 'all 0.2s', borderLeft: '3px solid #ef4444', border: '1px solid #fee2e2' }}
                        title="Ver bobinas encontradas em gôndola/gaveta divergente"
                      >
                        <div className="fw-bold" style={{ fontSize: '1.35rem', color: conferenciaTab === 'leituras' && conferenciaStatusFilter === 'divergencia' ? '#fff' : '#b91c1c' }}>
                          {kpiConferencia.divergencia}
                        </div>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: conferenciaTab === 'leituras' && conferenciaStatusFilter === 'divergencia' ? '#fecaca' : '#b91c1c' }}>
                          <i className="bi bi-geo-fill me-1"></i>Loc. Incorreto
                        </div>
                      </button>
                    </div>
                    <div className="col-6 col-md">
                      <button
                        onClick={() => { setConferenciaTab('faltando'); setConferenciaStatusFilter('faltando'); setPaginaAtual(1); }}
                        className={`w-100 border-0 rounded-3 p-2 text-start ${conferenciaTab === 'faltando' ? 'shadow' : ''}`}
                        style={{ background: conferenciaTab === 'faltando' ? '#b45309' : '#fffbeb', cursor: 'pointer', transition: 'all 0.2s', borderLeft: '3px solid #f59e0b', border: '1px solid #fef3c7' }}
                        title="Ver bobinas cadastradas no SAP que ainda não foram bipadas"
                      >
                        <div className="fw-bold" style={{ fontSize: '1.35rem', color: conferenciaTab === 'faltando' ? '#fff' : '#b45309' }}>
                          {carregandoPendentes ? <span className="spinner-border spinner-border-sm" role="status"></span> : kpiConferencia.faltando}
                        </div>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: conferenciaTab === 'faltando' ? '#fde68a' : '#b45309' }}>
                          <i className="bi bi-exclamation-triangle-fill me-1"></i>Pendentes SAP
                        </div>
                      </button>
                    </div>
                  </div>
                </div>

                {erroConferencia && (
                  <div className="alert alert-danger rounded-0 mb-0 py-2 px-3 small d-flex justify-content-between align-items-center gap-2">
                    <span><i className="bi bi-exclamation-octagon-fill me-1"></i>{erroConferencia}</span>
                    <button className="btn btn-sm btn-outline-danger" onClick={() => carregarConferencia(periodoConferencia)} disabled={carregandoAcao}>Tentar de novo</button>
                  </div>
                )}

                {/* Filtros Contextuais */}
                <div className="p-3" style={{ borderBottom: '1px solid #e2e8f0', backgroundColor: '#fff' }}>
                  <div className="row g-2 align-items-end">
                    {/* Período carregado do servidor (leituras e bases SAP importadas) */}
                    <div className="col-6 col-sm-4 col-lg-2">
                      <label className="form-label small fw-semibold text-secondary mb-1">
                        <i className="bi bi-clock-history me-1"></i>Período
                      </label>
                      <select
                        className="form-select form-select-sm"
                        value={periodoConferencia}
                        onChange={e => alterarPeriodoConferencia(Number(e.target.value))}
                        disabled={carregandoAcao}
                        title="Leituras carregadas do servidor"
                      >
                        {PERIODOS_CONFERENCIA.map(d => <option key={d} value={d}>Últimos {d} dias</option>)}
                      </select>
                    </div>

                    {/* Filtro Data do Inventário */}
                    <div className="col-6 col-sm-4 col-lg-2">
                      <label className="form-label small fw-semibold text-secondary mb-1">
                        <i className="bi bi-calendar-event me-1"></i>Data do Inventário
                      </label>
                      <select
                        className="form-select form-select-sm"
                        value={conferenciaFilters.data_leitura}
                        onChange={e => {
                          setConferenciaFilters(prev => ({ ...prev, data_leitura: e.target.value }));
                          setPaginaAtual(1);
                        }}
                      >
                        <option value="">Todas as Datas</option>
                        {listaDatasInventarios.map(d => {
                          const isHoje = d.dataIso === obterDataHojeIso();
                          return (
                            <option key={d.dataIso} value={d.dataIso}>
                              {d.dataFmt} {isHoje ? '(Hoje)' : ''}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {/* Filtro Colaborador (visível para Admin) */}
                    {isAdmin && (
                      <div className="col-12 col-sm-6 col-lg-3">
                        <label className="form-label small fw-semibold text-secondary mb-1">
                          <i className="bi bi-person-badge me-1"></i>Colaborador / Operador
                        </label>
                        <select
                          className="form-select form-select-sm"
                          value={conferenciaFilters.operador}
                          onChange={e => {
                            setConferenciaFilters(prev => ({ ...prev, operador: e.target.value }));
                            setPaginaAtual(1);
                          }}
                        >
                          <option value="">Todos os Colaboradores</option>
                          {listaOperadores.map(op => (
                            <option key={op.cracha} value={op.cracha}>
                              {op.nome} (Crachá: {op.cracha})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Unidade do colaborador (cadastro do crachá), independente da filial da bobina */}
                    {isAdmin && (
                      <div className="col-6 col-sm-4 col-lg-2">
                        <label className="form-label small fw-semibold text-secondary mb-1">
                          <i className="bi bi-building me-1"></i>Unidade Colab.
                        </label>
                        <select
                          className="form-select form-select-sm"
                          value={conferenciaFilters.unidade_operador}
                          onChange={e => {
                            setConferenciaFilters(prev => ({ ...prev, unidade_operador: e.target.value }));
                            setPaginaAtual(1);
                          }}
                        >
                          <option value="">Todas</option>
                          {listaUnidadesOperadores.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                    )}

                    {/* Filtro Depósito */}
                    <div className="col-6 col-sm-4 col-lg-2">
                      <label className="form-label small fw-semibold text-secondary mb-1">
                        <i className="bi bi-box me-1"></i>Depósito
                      </label>
                      <select
                        className="form-select form-select-sm"
                        value={conferenciaFilters.deposito}
                        onChange={e => {
                          setConferenciaFilters(prev => ({ ...prev, deposito: e.target.value }));
                          setPaginaAtual(1);
                        }}
                      >
                        <option value="">Todos</option>
                        {depositosDisponiveis.map(d => <option key={d.id} value={d.id}>{d.id}</option>)}
                      </select>
                    </div>

                    {/* Busca Lote / Romaneio */}
                    <div className={`col-6 col-sm-4 ${isAdmin ? 'col-lg-2' : 'col-lg-4'}`}>
                      <label className="form-label small fw-semibold text-secondary mb-1">
                        <i className="bi bi-search me-1"></i>Buscar Código
                      </label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="Lote, romaneio..."
                        value={conferenciaFilters.lote}
                        onChange={e => {
                          setConferenciaFilters(prev => ({ ...prev, lote: e.target.value }));
                          setPaginaAtual(1);
                        }}
                      />
                    </div>

                    {/* Botão Limpar Filtros */}
                    <div className="col-12 col-sm-auto d-flex align-items-end">
                      <button
                        className="btn btn-outline-danger btn-sm w-100"
                        title="Limpar todos os filtros"
                        onClick={() => {
                          setConferenciaFilters({ lote: '', data_leitura: '', filial: '', deposito: '', operador: '', unidade_operador: '' });
                          setConferenciaStatusFilter('todos');
                          setPaginaAtual(1);
                        }}
                      >
                        <i className="bi bi-x-lg me-1"></i>Limpar
                      </button>
                    </div>
                  </div>

                  {/* Banner de Contexto Ativo (Data / Colaborador) */}
                  {(conferenciaFilters.operador || conferenciaFilters.data_leitura) && (
                    <div className="mt-3 p-2 px-3 rounded-2 d-flex justify-content-between align-items-center flex-wrap gap-2" style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe' }}>
                      <div className="d-flex align-items-center gap-2 small">
                        <i className="bi bi-info-circle-fill text-primary fs-5"></i>
                        <span>
                          {conferenciaFilters.data_leitura ? (
                            <>Inventário de <strong>{listaDatasInventarios.find(d => d.dataIso === conferenciaFilters.data_leitura)?.dataFmt || conferenciaFilters.data_leitura}</strong></>
                          ) : (
                            <>Todas as datas</>
                          )}
                          {conferenciaFilters.operador && (
                            <> · Colaborador: <strong>{listaOperadores.find(o => String(o.cracha) === String(conferenciaFilters.operador))?.nome || conferenciaFilters.operador}</strong></>
                          )}
                          {' · '}<strong>{itensNoContexto.length}</strong> bobinas nesta contagem
                        </span>
                      </div>
                      <button
                        className="btn btn-sm btn-link text-primary text-decoration-none p-0 fw-semibold small"
                        onClick={() => {
                          setConferenciaFilters(prev => ({ ...prev, operador: '', data_leitura: '' }));
                          setConferenciaTab('inventarios');
                          setPaginaAtual(1);
                        }}
                      >
                        <i className="bi bi-arrow-counterclockwise me-1"></i>Ver todos os inventários
                      </button>
                    </div>
                  )}
                </div>

                {/* ============================================================== */}
                {/* ABA 1: RESUMO DE INVENTÁRIOS REALIZADOS (DATA + COLABORADOR)  */}
                {/* ============================================================== */}
                {conferenciaTab === 'inventarios' && (
                  <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
                    <table className="table table-hover table-sm align-middle mb-0" style={{ fontSize: '0.84rem' }}>
                      <thead style={{ position: 'sticky', top: 0, zIndex: 2, backgroundColor: '#f1f5f9' }}>
                        <tr>
                          <th className="py-2 px-3 text-secondary text-uppercase" style={{ fontSize: '0.7rem', fontWeight: 700 }}>Data do Inventário</th>
                          <th className="py-2 px-3 text-secondary text-uppercase" style={{ fontSize: '0.7rem', fontWeight: 700 }}>Colaborador</th>
                          <th className="py-2 px-3 text-secondary text-uppercase" style={{ fontSize: '0.7rem', fontWeight: 700 }}>Depósitos</th>
                          <th className="py-2 px-3 text-secondary text-uppercase text-center" style={{ fontSize: '0.7rem', fontWeight: 700 }}>Total Contado</th>
                          <th className="py-2 px-3 text-secondary text-uppercase text-center" style={{ fontSize: '0.7rem', fontWeight: 700 }}>OK (No SAP)</th>
                          <th className="py-2 px-3 text-secondary text-uppercase text-center" style={{ fontSize: '0.7rem', fontWeight: 700 }}>Sobra (Não SAP)</th>
                          <th className="py-2 px-3 text-secondary text-uppercase text-center" style={{ fontSize: '0.7rem', fontWeight: 700 }}>Loc. Incorreto</th>
                          <th className="py-2 px-3 text-secondary text-uppercase text-center" style={{ fontSize: '0.7rem', fontWeight: 700 }}>Acurácia</th>
                          <th className="py-2 px-3 text-secondary text-uppercase text-center" style={{ fontSize: '0.7rem', fontWeight: 700 }}>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inventariosPaginados.length === 0 ? (
                          <tr>
                            <td colSpan="9" className="text-center text-muted py-5">
                              <i className="bi bi-calendar-x fs-2 d-block mb-2 opacity-50"></i>
                              Nenhum inventário encontrado para os filtros selecionados
                            </td>
                          </tr>
                        ) : inventariosPaginados.map(inv => {
                          const taxa = inv.total > 0 ? ((inv.ok / inv.total) * 100).toFixed(1) : 0;
                          const isHoje = inv.dataIso === obterDataHojeIso();
                          return (
                            <tr key={inv.id}>
                              <td className="py-2 px-3">
                                <div className="d-flex align-items-center gap-2">
                                  <span className="fw-bold text-dark">{inv.dataFmt}</span>
                                  {isHoje && (
                                    <span className="badge bg-success bg-opacity-25 text-success fw-bold px-2 py-0" style={{ fontSize: '0.68rem' }}>
                                      Hoje
                                    </span>
                                  )}
                                </div>
                                <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                                  <i className="bi bi-clock me-1"></i>{inv.primeiraHora} às {inv.ultimaHora}
                                </div>
                              </td>
                              <td className="py-2 px-3">
                                <div className="d-flex align-items-center gap-2">
                                  <div className="rounded-circle bg-primary bg-opacity-10 text-primary fw-bold d-flex align-items-center justify-content-center" style={{ width: '32px', height: '32px', fontSize: '0.75rem' }}>
                                    {obterIniciais(inv.nome)}
                                  </div>
                                  <div>
                                    <div className="fw-bold text-dark">{inv.nome}</div>
                                    <div className="text-muted" style={{ fontSize: '0.72rem' }}>Crachá: {inv.cracha}</div>
                                    {(inv.unidadeOperador !== '-' || inv.setorOperador !== '-') && (
                                      <div className="text-muted" style={{ fontSize: '0.7rem' }}>
                                        <i className="bi bi-building me-1"></i>{[inv.unidadeOperador !== '-' && `Unid. ${inv.unidadeOperador}`, inv.setorOperador !== '-' && inv.setorOperador].filter(Boolean).join(' · ')}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="py-2 px-3 small text-muted">
                                {Array.from(inv.depositos).join(', ') || '-'}
                              </td>
                              <td className="py-2 px-3 text-center fw-bold fs-6 text-dark">
                                {inv.total}
                                {inv.repetidas > 0 && <div className="text-muted fw-normal" style={{ fontSize: '0.68rem' }} title="Leituras repetidas da mesma bobina neste inventário">+{inv.repetidas} rep.</div>}
                              </td>
                              <td className="py-2 px-3 text-center">
                                <span className="badge bg-success bg-opacity-15 text-success fw-bold px-2 py-1" style={{ fontSize: '0.75rem' }}>
                                  {inv.ok}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-center">
                                <span className="badge fw-bold px-2 py-1" style={{ backgroundColor: '#ede9fe', color: '#7c3aed', fontSize: '0.75rem' }}>
                                  {inv.sobrando}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-center">
                                <span className="badge bg-danger bg-opacity-15 text-danger fw-bold px-2 py-1" style={{ fontSize: '0.75rem' }}>
                                  {inv.divergencia}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-center" style={{ minWidth: '100px' }}>
                                <div className="fw-bold small mb-1">{taxa}%</div>
                                <div className="progress" style={{ height: '4px' }}>
                                  <div className="progress-bar bg-success" style={{ width: `${taxa}%` }}></div>
                                </div>
                              </td>
                              <td className="py-2 px-3 text-center">
                                <button
                                  className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
                                  onClick={() => {
                                    setConferenciaFilters(prev => ({ ...prev, operador: String(inv.cracha), data_leitura: inv.dataIso }));
                                    setConferenciaTab('leituras');
                                    setPaginaAtual(1);
                                  }}
                                  title="Ver as bobinas contadas neste inventário específico"
                                >
                                  <i className="bi bi-box-seam"></i> Ver Bobinas ({inv.total})
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* ============================================================== */}
                {/* ABA 2: BOBINAS CONTADAS (LEITURAS)                             */}
                {/* ============================================================== */}
                {conferenciaTab === 'leituras' && (
                  <>
                    {/* Tabela Desktop */}
                    <div className="d-none d-md-block" style={{ maxHeight: '380px', overflowY: 'auto' }}>
                      <table className="table table-hover table-sm align-middle mb-0" style={{ fontSize: '0.82rem' }}>
                        <thead style={{ position: 'sticky', top: 0, zIndex: 2, backgroundColor: '#f1f5f9' }}>
                          <tr>
                            <th className="py-2 px-3" style={{ fontWeight: 700, color: '#475569', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>Lote / Romaneio</th>
                            <th className="py-2 px-3" style={{ fontWeight: 700, color: '#475569', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.5px' }}>Material</th>
                            <th className="py-2 px-3" style={{ fontWeight: 700, color: '#475569', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>Endereço Lido</th>
                            <th className="py-2 px-3" style={{ fontWeight: 700, color: '#475569', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>Endereço SAP</th>
                            <th className="py-2 px-3" style={{ fontWeight: 700, color: '#475569', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.5px' }}>Status</th>
                            {isAdmin && <th className="py-2 px-3" style={{ fontWeight: 700, color: '#475569', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.5px' }}>Colaborador</th>}
                            <th className="py-2 px-3" style={{ fontWeight: 700, color: '#475569', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>Data/Hora</th>
                          </tr>
                        </thead>
                        <tbody>
                          {leiturasPaginadas.length === 0 ? (
                            <tr>
                              <td colSpan={isAdmin ? 7 : 6} className="text-center text-muted py-5">
                                <i className="bi bi-inbox fs-3 d-block mb-2 opacity-50"></i>
                                Nenhuma bobina encontrada para os filtros selecionados
                              </td>
                            </tr>
                          ) : leiturasPaginadas.map((leitura, index) => {
                            const confKey = `conf_tbl_${leitura.codigo}_${index}`;
                            const expandido = lotesExpandidos[confKey];
                            const badgeConfig = {
                              ok: { bg: '#dcfce7', color: '#15803d', icon: 'bi-check-circle-fill', label: 'OK' },
                              faltando: { bg: '#fef9c3', color: '#b45309', icon: 'bi-exclamation-triangle-fill', label: 'Faltando' },
                              sobrando: { bg: '#ede9fe', color: '#7c3aed', icon: 'bi-plus-circle-fill', label: 'Sobra' },
                              divergencia: { bg: '#fee2e2', color: '#b91c1c', icon: 'bi-geo-fill', label: 'Local Incorreto' },
                            }[leitura.tipo] || { bg: '#f1f5f9', color: '#475569', icon: 'bi-question-circle', label: leitura.status };
                            const rowBg = expandido ? '#f8fafc' : '#fff';
                            return (
                              <React.Fragment key={confKey}>
                                <tr onClick={() => toggleLoteExpandido(confKey)} style={{ cursor: 'pointer', backgroundColor: rowBg, transition: 'background 0.15s' }}>
                                  <td className="px-3 py-2">
                                    <span className="vp-mono fw-bold" style={{ color: '#1e293b' }}>{leitura.codigo || '-'}</span>
                                    {leitura.romaneio && leitura.romaneio !== '-' && <div className="text-muted" style={{ fontSize: '0.72rem' }}>ROM: {leitura.romaneio}</div>}
                                  </td>
                                  <td className="px-3 py-2">
                                    <div style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={leitura.descricao}>
                                      {leitura.material !== '-' ? leitura.material : ''}{leitura.material !== '-' && leitura.descricao !== '-' ? ' · ' : ''}
                                      <span className="text-muted">{leitura.descricao !== '-' ? leitura.descricao : '-'}</span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2"><span style={{ fontSize: '0.78rem', color: '#0284c7', fontWeight: 600 }}>{leitura.endereco_lido || '-'}</span></td>
                                  <td className="px-3 py-2"><span style={{ fontSize: '0.78rem' }}>{leitura.endereco_sap || '-'}</span></td>
                                  <td className="px-3 py-2">
                                    <span className="badge rounded-pill d-inline-flex align-items-center gap-1" style={{ backgroundColor: badgeConfig.bg, color: badgeConfig.color, fontSize: '0.72rem', fontWeight: 700, padding: '4px 10px', whiteSpace: 'nowrap' }}>
                                      <i className={`bi ${badgeConfig.icon}`}></i>{badgeConfig.label}
                                    </span>
                                    {leitura.repetida && <span className="badge rounded-pill bg-secondary bg-opacity-25 text-secondary ms-1" style={{ fontSize: '0.68rem' }} title="Esta bobina já tinha sido lida neste contexto; não entra nos totais">Repetida</span>}
                                  </td>
                                  {isAdmin && (
                                    <td className="px-3 py-2">
                                      <div className="fw-semibold text-dark" style={{ fontSize: '0.78rem' }}>{leitura.nome || leitura.cracha || '-'}</div>
                                      <div className="text-muted" style={{ fontSize: '0.7rem' }}>Crachá: {leitura.cracha}{leitura.unidadeOperador !== '-' ? ` · Unid. ${leitura.unidadeOperador}` : ''}</div>
                                    </td>
                                  )}
                                  <td className="px-3 py-2 text-muted" style={{ whiteSpace: 'nowrap', fontSize: '0.78rem' }}>{leitura.dataHora || '-'}</td>
                                </tr>
                                {expandido && (
                                  <tr style={{ backgroundColor: '#f8fafc' }}>
                                    <td colSpan={isAdmin ? 7 : 6} className="p-0">
                                      <div className="p-3 border-top border-bottom" style={{ fontSize: '0.8rem' }}>
                                        <div className="row g-3">
                                          <div className="col-6 col-md-3"><div className="text-muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>Peso Líquido</div><div className="fw-semibold">{leitura.peso_liquido !== '-' ? `${leitura.peso_liquido} kg` : '-'}</div></div>
                                          <div className="col-6 col-md-3"><div className="text-muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>Dimensões</div><div className="fw-semibold">{leitura.largura !== '-' && leitura.espessura !== '-' ? `${leitura.largura} mm × ${leitura.espessura} µm` : '-'}</div></div>
                                          <div className="col-6 col-md-3"><div className="text-muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>Filial da Bobina</div><div className="fw-semibold">{leitura.filial || '-'}</div></div>
                                          <div className="col-6 col-md-3"><div className="text-muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>Depósito</div><div className="fw-semibold">{leitura.deposito || '-'}</div></div>
                                          <div className="col-6 col-md-3"><div className="text-muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>Agrupador</div><div className="fw-semibold">{leitura.agrupador || '-'}</div></div>
                                          <div className="col-6 col-md-3"><div className="text-muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>Rota</div><div className="fw-semibold">{leitura.rota || '-'}</div></div>
                                          <div className="col-6 col-md-3"><div className="text-muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>OP / OV</div><div className="fw-semibold">{leitura.ordem_producao || '-'} / {leitura.ordem_venda || '-'}</div></div>
                                          <div className="col-12 col-md-9"><div className="text-muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>Cliente</div><div className="fw-semibold">{[leitura.cliente, leitura.nome_cliente].filter(v => v && v !== '-').join(' — ') || '-'}</div></div>
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

                    {/* Cards Mobile */}
                    <div className="d-md-none" style={{ maxHeight: '58vh', overflowY: 'auto', backgroundColor: '#f8fafc', padding: '0.75rem' }}>
                      {leiturasPaginadas.length === 0 ? (
                        <div className="text-center text-muted p-4"><i className="bi bi-inbox fs-2 d-block mb-2 opacity-50"></i>Nenhum registro encontrado.</div>
                      ) : leiturasPaginadas.map((leitura, index) => {
                        const confKey = `conf_mob_${leitura.codigo}_${index}`;
                        const expandido = lotesExpandidos[confKey];
                        const tipoConfig = {
                          ok: { border: '#22c55e', bg: '#f0fdf4', badgeBg: '#dcfce7', badgeColor: '#15803d', icon: 'bi-check-circle-fill', label: 'OK' },
                          faltando: { border: '#f59e0b', bg: '#fffbeb', badgeBg: '#fef9c3', badgeColor: '#b45309', icon: 'bi-exclamation-triangle-fill', label: 'Faltando' },
                          sobrando: { border: '#8b5cf6', bg: '#faf5ff', badgeBg: '#ede9fe', badgeColor: '#7c3aed', icon: 'bi-plus-circle-fill', label: 'Sobra' },
                          divergencia: { border: '#ef4444', bg: '#fff1f2', badgeBg: '#fee2e2', badgeColor: '#b91c1c', icon: 'bi-geo-fill', label: 'Local Incorreto' },
                        }[leitura.tipo] || { border: '#94a3b8', bg: '#f8fafc', badgeBg: '#f1f5f9', badgeColor: '#475569', icon: 'bi-question', label: leitura.status };
                        return (
                          <div key={confKey} className="mb-2 rounded-3 shadow-sm overflow-hidden" onClick={() => toggleLoteExpandido(confKey)} style={{ backgroundColor: tipoConfig.bg, border: `1px solid ${tipoConfig.border}`, cursor: 'pointer', borderLeft: `4px solid ${tipoConfig.border}` }}>
                            <div className="p-3">
                              <div className="d-flex justify-content-between align-items-start">
                                <span className="vp-mono fw-bold" style={{ color: '#1e293b', fontSize: '0.9rem' }}>{leitura.codigo}</span>
                                <span className="d-inline-flex gap-1">
                                  {leitura.repetida && <span className="badge rounded-pill bg-secondary bg-opacity-25 text-secondary" style={{ fontSize: '0.68rem' }}>Repetida</span>}
                                  <span className="badge rounded-pill d-inline-flex align-items-center gap-1" style={{ backgroundColor: tipoConfig.badgeBg, color: tipoConfig.badgeColor, fontSize: '0.68rem', fontWeight: 700 }}>
                                    <i className={`bi ${tipoConfig.icon}`}></i>{tipoConfig.label}
                                  </span>
                                </span>
                              </div>
                              {leitura.descricao !== '-' && <div className="text-muted mt-1" style={{ fontSize: '0.75rem' }}>{leitura.descricao}</div>}
                              <div className="d-flex gap-2 mt-2 flex-wrap">
                                {leitura.dataHora !== '-' && <span className="text-muted" style={{ fontSize: '0.72rem' }}><i className="bi bi-clock me-1"></i>{leitura.dataHora}</span>}
                                {leitura.nome !== '-' && <span className="text-muted" style={{ fontSize: '0.72rem' }}><i className="bi bi-person me-1"></i>{leitura.nome}</span>}
                              </div>
                              {expandido && (
                                <div className="mt-3 pt-3 border-top" style={{ borderColor: `${tipoConfig.border}66 !important` }}>
                                  <div className="row g-2" style={{ fontSize: '0.78rem' }}>
                                    <div className="col-12"><span className="text-muted d-block" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700 }}>Endereço Lido</span><span className="fw-bold" style={{ color: '#0284c7' }}>{leitura.endereco_lido || '-'}</span></div>
                                    <div className="col-12"><span className="text-muted d-block" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700 }}>Endereço SAP</span><span className="fw-semibold">{leitura.endereco_sap || '-'}</span></div>
                                    <div className="col-6"><span className="text-muted d-block" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700 }}>Peso</span><span className="fw-semibold">{leitura.peso_liquido !== '-' ? `${leitura.peso_liquido} kg` : '-'}</span></div>
                                    <div className="col-6"><span className="text-muted d-block" style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700 }}>Depósito</span><span className="fw-semibold">{leitura.deposito || '-'}</span></div>
                                    <div className="col-12 text-center mt-1"><span className="text-muted" style={{ fontSize: '0.72rem' }}><i className="bi bi-chevron-up"></i> Recolher</span></div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* ============================================================== */}
                {/* ABA 3: BOBINAS PENDENTES NO SAP (FALTANDO)                     */}
                {/* ============================================================== */}
                {conferenciaTab === 'faltando' && (
                  <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
                    <div className="p-2 px-3 bg-warning bg-opacity-10 text-dark small border-bottom d-flex align-items-center gap-2">
                      <i className="bi bi-info-circle-fill text-warning fs-5"></i>
                      <span>
                        Bobinas das bases <strong>SAP</strong> importadas no período ao lado que <strong>não foram bipadas</strong> por nenhum colaborador nos últimos {periodoConferencia} dias. Lote importado em mais de uma base aparece só pela importação mais recente.
                      </span>
                      <select
                        className="form-select form-select-sm ms-auto"
                        style={{ width: 'auto' }}
                        value={periodoPendentes}
                        onChange={e => alterarPeriodoPendentes(Number(e.target.value))}
                        disabled={carregandoPendentes}
                        title="Bases SAP importadas nos últimos dias"
                      >
                        {PERIODOS_PENDENTES.map(d => <option key={d} value={d}>Bases de {d === 1 ? 'hoje/ontem' : `${d} dias`}</option>)}
                      </select>
                    </div>
                    <table className="table table-hover table-sm align-middle mb-0" style={{ fontSize: '0.82rem' }}>
                      <thead style={{ position: 'sticky', top: 0, zIndex: 2, backgroundColor: '#f1f5f9' }}>
                        <tr>
                          <th className="py-2 px-3" style={{ fontWeight: 700, color: '#475569', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>Lote / Romaneio</th>
                          <th className="py-2 px-3" style={{ fontWeight: 700, color: '#475569', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.5px' }}>Material</th>
                          <th className="py-2 px-3" style={{ fontWeight: 700, color: '#475569', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>Depósito SAP</th>
                          <th className="py-2 px-3" style={{ fontWeight: 700, color: '#475569', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>Endereço SAP</th>
                          <th className="py-2 px-3" style={{ fontWeight: 700, color: '#475569', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.5px' }}>Peso</th>
                          <th className="py-2 px-3" style={{ fontWeight: 700, color: '#475569', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.5px' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {faltandoPaginadas.length === 0 && linhasBaseSapPeriodo === 0 ? (
                          <tr>
                            <td colSpan="6" className="text-center text-muted py-5">
                              <i className="bi bi-database-x fs-2 d-block mb-2 opacity-50"></i>
                              {carregandoPendentes ? 'Carregando bases SAP...' : `Nenhuma base SAP foi importada nos últimos ${periodoPendentes} dias.`}
                            </td>
                          </tr>
                        ) : faltandoPaginadas.length === 0 ? (
                          <tr>
                            <td colSpan="6" className="text-center text-success py-5">
                              <i className="bi bi-check-circle-fill fs-2 d-block mb-2 text-success"></i>
                              Parabéns! Todas as bobinas esperadas no SAP para este contexto foram bipadas!
                            </td>
                          </tr>
                        ) : faltandoPaginadas.map((item, idx) => (
                          <tr key={`faltando_${item.codigo}_${idx}`}>
                            <td className="px-3 py-2">
                              <span className="vp-mono fw-bold text-dark">{item.codigo}</span>
                              {item.romaneio && item.romaneio !== '-' && <div className="text-muted" style={{ fontSize: '0.72rem' }}>ROM: {item.romaneio}</div>}
                            </td>
                            <td className="px-3 py-2">
                              <div style={{ maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.descricao}>
                                {item.material !== '-' ? item.material : ''}{item.material !== '-' && item.descricao !== '-' ? ' · ' : ''}
                                <span className="text-muted">{item.descricao !== '-' ? item.descricao : '-'}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2"><span className="badge bg-light text-dark border">{item.deposito || '-'}</span></td>
                            <td className="px-3 py-2"><span style={{ fontSize: '0.78rem' }}>{item.endereco_sap || '-'}</span></td>
                            <td className="px-3 py-2 text-muted">{item.peso_liquido !== '-' ? `${item.peso_liquido} kg` : '-'}</td>
                            <td className="px-3 py-2">
                              <span className="badge bg-warning bg-opacity-25 text-dark fw-bold px-2 py-1">
                                <i className="bi bi-clock-history me-1"></i>Pendente
                              </span>
                              {item.dataImportIso && <div className="text-muted" style={{ fontSize: '0.68rem' }}>base de {item.dataImportIso.split('-').reverse().join('/')}</div>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Paginação */}
                {totalPaginas > 1 && (
                  <div className="d-flex justify-content-between align-items-center px-3 py-2" style={{ borderTop: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => setPaginaAtual(prev => Math.max(prev - 1, 1))} disabled={paginaAtual === 1}>
                      <i className="bi bi-chevron-left"></i> Anterior
                    </button>
                    <span className="small text-muted fw-semibold">Página {paginaCorrigida} de {totalPaginas}</span>
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => setPaginaAtual(prev => Math.min(prev + 1, totalPaginas))} disabled={paginaAtual === totalPaginas}>
                      Próxima <i className="bi bi-chevron-right"></i>
                    </button>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="modal-footer border-0 justify-content-between px-4 pb-4" style={{ backgroundColor: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                <button type="button" className="btn btn-outline-success d-flex align-items-center gap-2" onClick={exportarConferencia} title="Exportar dados filtrados para CSV">
                  <i className="bi bi-download"></i> Exportar CSV
                </button>
                <button type="button" className="vp-btn vp-btn-dark" onClick={() => setShowConferencia(false)}>Fechar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="container px-3 px-md-0 pt-2 pb-5" style={{ maxWidth: '800px', width: '100%' }}>
        <Header />
        <div className="vp-operator-card animate__animated animate__fadeIn mb-4">
          <div className="vp-operator-info"><div className="vp-operator-avatar">{obterIniciais(nomeLogado)}</div><div><span className="vp-micro-label" style={{ margin: 0 }}>Operador Logado</span><h4 className="vp-operator-name">{nomeLogado}</h4><span className="vp-operator-badge"><i className="bi bi-person-badge"></i> {crachaLogado}</span>{(perfilLogado.unidade || perfilLogado.setor) && <div className="text-muted mt-1" style={{ fontSize: '0.75rem' }}><i className="bi bi-building me-1"></i>{[perfilLogado.unidade && `Unidade ${perfilLogado.unidade}`, perfilLogado.setor].filter(Boolean).join(' · ')}</div>}</div></div>
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
                      <div className="col-6 text-start"><label className="form-label small fw-bold text-secondary mb-2">Gôndola (Opcional)</label><input ref={gondolaInputRef} type="text" className="form-control form-control-lg w-100 text-center shadow-sm" placeholder="Ex: E" value={gondolaAtual} onChange={e => setGondolaAtual(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && gavetaInputRef.current?.focus()} style={{ height: '54px' }} /></div>
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
                    {errorCount > 0 && (
                      <span className="badge bg-danger" title="Leituras recusadas pelo servidor. Toque para tentar enviar de novo." onClick={reenviarComErro} style={{ cursor: 'pointer' }}>
                        <i className="bi bi-exclamation-triangle-fill me-1"></i>{errorCount} com erro — reenviar
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

        {mostrarBannerAtualizacao && (
          <div className="vp-update-banner">
            <div className="vp-update-banner-content">
              <i className="bi bi-cloud-arrow-down-fill me-2 fs-5 text-warning"></i>
              <span>Nova atualização do Inventário disponível! Deseja aplicar agora?</span>
            </div>
            <div className="vp-update-banner-actions">
              <button className="vp-btn vp-btn-success btn-sm me-1 px-3" onClick={aceitarAtualizacao}>
                <i className="bi bi-arrow-clockwise"></i> Atualizar
              </button>
              <button className="vp-btn vp-btn-ghost-danger btn-sm px-2" onClick={() => setMostrarBannerAtualizacao(false)}>
                Depois
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App