import React, { useState, useRef, useEffect } from 'react'
import Header from './components/Header'
import Scanner from './components/Scanner'
import logoVideplast from './assets/videplast-brand.png'
import { supabase } from './supabase'
import FilterControls from './components/FilterControls'
import ProcessadorDrone from './components/ProcessadorDrone'
import './App.css'

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
  if (prefixo === 'VA') return '1001';
  if (prefixo === 'RA') return '1005';
  if (prefixo === 'MA') return '1003';
  return null;
};

function App() {
  // ESTADOS DE LOGIN
  const [crachaLogado, setCrachaLogado] = useState(() => sessionStorage.getItem('usuario_cracha') || '');
  const [nomeLogado, setNomeLogado] = useState(() => sessionStorage.getItem('usuario_nome') || '');
  const [inputCracha, setInputCracha] = useState('');
  const [carregandoLogin, setCarregandoLogin] = useState(false);
  const [isAdmin, setIsAdmin] = useState(() => sessionStorage.getItem('usuario_is_admin') === 'true');
  const [leiturasGlobais, setLeiturasGlobais] = useState([]);

  // ESTADOS DO FILTRO E PAGINAÇÃO DA CONFERÊNCIA
  const [conferenciaFilters, setConferenciaFilters] = useState({ lote: '', data_leitura: '', filial: '', deposito: '' });
  const [conferenciaSort, setConferenciaSort] = useState({ field: 'Data', order: 'desc' });
  const [paginaAtual, setPaginaAtual] = useState(1);
  const ITENS_POR_PAGINA = 50; // Limite de itens por página para não travar o celular

  const [usandoDrone, setUsandoDrone] = useState(false);

  // ESTADOS DO INVENTÁRIO 
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
    show: false, title: '', message: '', type: 'alert', onConfirm: null
  })

  const [showConferencia, setShowConferencia] = useState(false);
  const [lotesExpandidos, setLotesExpandidos] = useState({});

  const toggleLoteExpandido = (loteKey) => {
    setLotesExpandidos(prev => ({
      ...prev,
      [loteKey]: !prev[loteKey]
    }));
  };

  const inputRef = useRef(null)
  const fileInputRef = useRef(null)

  // EFEITOS
  useEffect(() => {
    sessionStorage.setItem('csv_bobinas', JSON.stringify(csvBobinas));
    sessionStorage.setItem('lidas_bobinas', JSON.stringify(bobinasLidas));
    if (sessaoId) sessionStorage.setItem('sessao_id', sessaoId);
    else sessionStorage.removeItem('sessao_id');
  }, [csvBobinas, bobinasLidas, sessaoId]);

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
    if (crachaLogado && inputRef.current && !modal.show && !showConferencia && !usandoCamera) {
      inputRef.current.focus();
    }
  }, [crachaLogado, modal.show, showConferencia, usandoCamera]);

  // EFEITO DE PAGINAÇÃO: Volta para a página 1 se o usuário digitar algo na busca
  useEffect(() => {
    setPaginaAtual(1);
    setLotesExpandidos({}); // Fecha as abas ao mudar de página ou filtro
  }, [conferenciaFilters, conferenciaSort]);


  // FUNÇÕES DE MODAL
  const fecharModal = () => setModal({ ...modal, show: false });

  const abrirAlerta = (titulo, message) => {
    setModal({ show: true, title: titulo, message: message, type: 'alert', onConfirm: null });
  }

  const abrirConfirmacao = (titulo, message, acaoConfirmar) => {
    setModal({
      show: true, title: titulo, message: message, type: 'confirm',
      onConfirm: () => { acaoConfirmar(); fecharModal(); }
    });
  }

  // FUNÇÕES DE LOGIN
  const fazerLogin = async () => {
    if (!inputCracha.trim()) {
      abrirAlerta('Atenção', 'Por favor, insira o número do seu crachá.');
      return;
    }

    setCarregandoLogin(true);

    try {
      const { data, error } = await supabase
        .from('crachas')
        .select('id, nome_completo, admin')
        .eq('id', inputCracha.trim())
        .single();

      if (error) {
        console.error("Erro detalhado do Supabase:", error);
        abrirAlerta('Acesso Negado', 'Crachá não encontrado. Verifique se o número está correto.');
        setCarregandoLogin(false);
        return;
      }

      if (data) {
        setCrachaLogado(inputCracha.trim());
        setNomeLogado(data.nome_completo || 'Operador');
        setIsAdmin(!!data.admin);
      }

    } catch (err) {
      console.error(err);
      abrirAlerta('Erro', 'Não foi possível conectar ao banco de dados Supabase.');
    } finally {
      setCarregandoLogin(false);
    }
  }

  const fazerLogout = () => {
    abrirConfirmacao('Sair', 'Deseja sair? Seus dados continuarão na tela.', () => {
      setCrachaLogado('');
      setNomeLogado('');
      setInputCracha('');
      setIsAdmin(false);
    });
  }

  const garantirSessao = async () => {
    if (sessaoId) {
      const { data } = await supabase
        .from('sessoes_inventario')
        .select('id')
        .eq('id', sessaoId)
        .maybeSingle();

      if (data) return sessaoId;
    }

    const { data, error } = await supabase
      .from('sessoes_inventario')
      .insert([{ cracha_importacao: crachaLogado, status: 'Em andamento' }])
      .select('id')
      .single();

    if (error) {
      console.error("Erro ao criar sessão:", error);
      throw error;
    }

    setSessaoId(data.id);
    return data.id;
  }

  const limparValorParaBanco = (valor) => {
    if (valor === undefined || valor === null || String(valor).trim() === '') return null;
    return String(valor).trim();
  }

  const limparNumeroParaBanco = (valor) => {
    if (valor === undefined || valor === null || String(valor).trim() === '') return null;
    let formatado = String(valor).trim();

    if (formatado.includes(',')) {
      formatado = formatado.replace(/\./g, '').replace(',', '.');
    }
    return formatado;
  }

  const abrirConferenciaAdmin = async () => {
    setShowConferencia(true);
    setPaginaAtual(1); // Garante que abre na primeira página

    setCarregandoAcao(true);
    try {
      const { data: leituras, error: erroLeituras } = await supabase
        .from('bobinas_lidas')
        .select('*');

      const { data: crachas } = await supabase
        .from('crachas')
        .select('id, nome_completo');

      const { data: sapBanco } = await supabase
        .from('bobinas_sap')
        .select('*');

      if (erroLeituras) throw erroLeituras;

      if (leituras) {
        const listaGlobal = leituras.map(b => {
          const dono = crachas?.find(c => c.id === b.cracha_leitura);
          const dadosSap = sapBanco?.find(s => s.lote === b.lote) || csvBobinas.find(c => c.lote === b.lote);

          const dataOriginal = b.created_at || b.data_hora || b.data_leitura || b.data_registro;
          let dataFormatada = '-';
          if (dataOriginal) {
            dataFormatada = new Date(dataOriginal).toLocaleString('pt-BR');
          }

          const filialFinal = b.filial || (dadosSap ? dadosSap.filial : null) || determinarFilial(b.lote) || '-';

          return {
            codigo: b.lote,
            dataHora: dataFormatada,
            cracha: b.cracha_leitura,
            nome: dono ? dono.nome_completo : b.cracha_leitura,
            filial: filialFinal,
            deposito: b.deposito || (dadosSap ? (dadosSap.deposito || '-') : '-'),
            material: dadosSap ? (dadosSap.material || '-') : '-',
            descricao: dadosSap ? (dadosSap.descricao || '-') : '-',
            peso_liquido: dadosSap ? (dadosSap.peso_liquido || '-') : '-',
            largura: dadosSap ? (dadosSap.largura || '-') : '-',
            espessura: dadosSap ? (dadosSap.espessura || '-') : '-',
            ordem_producao: dadosSap ? (dadosSap.ordem_producao || '-') : '-',
            ordem_venda: dadosSap ? (dadosSap.ordem_venda || '-') : '-',
            cliente: dadosSap ? (dadosSap.cliente || '-') : '-',
            nome_cliente: dadosSap ? (dadosSap.nome_cliente || '-') : '-'
          };
        });

        setLeiturasGlobais(listaGlobal);
      }
    } catch (err) {
      console.error("Erro ao sincronizar as leituras globais:", err);
    } finally {
      setCarregandoAcao(false);
    }
  };

  // FUNÇÕES DE INVENTÁRIO
  const importarCSV = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setCarregandoAcao(true);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target.result;
        const linhas = text.split(/\r?\n/).filter(linha => linha.trim() !== '');

        if (linhas.length === 0) {
          setCarregandoAcao(false);
          return;
        }

        let idxCabecalho = 0;
        for (let i = 0; i < Math.min(10, linhas.length); i++) {
          if (linhas[i].toLowerCase().includes('lote')) {
            idxCabecalho = i;
            break;
          }
        }

        const linhaCabecalho = linhas[idxCabecalho];
        const countPontoVirgula = (linhaCabecalho.match(/;/g) || []).length;
        const countVirgula = (linhaCabecalho.match(/,/g) || []).length;
        const separator = countPontoVirgula > countVirgula ? ';' : ',';

        const parseCSVLine = (line) => {
          let result = [];
          let current = '';
          let inQuotes = false;
          for (let i = 0; i < line.length; i++) {
            let char = line[i];
            if (char === '"') {
              if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
              } else {
                inQuotes = !inQuotes;
              }
            } else if (char === separator && !inQuotes) {
              result.push(current);
              current = '';
            } else {
              current += char;
            }
          }
          result.push(current);
          return result.map(val => val.trim());
        };

        const headersRaw = parseCSVLine(linhaCabecalho);

        const headersLimpos = headersRaw.map(h =>
          h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "")
        );

        const getIdx = (termo) => headersLimpos.indexOf(termo);

        const idxLote = getIdx('lote');
        const idxMaterial = getIdx('material');
        const idxOrdem = getIdx('ordemproducao') !== -1 ? getIdx('ordemproducao') : getIdx('ordemproduao');
        const idxCliente = getIdx('cliente');
        const idxNomeCliente = getIdx('nome');
        const idxPesoLiquido = getIdx('pesoliquido');
        const idxLargura = getIdx('largura');
        const idxEspessura = getIdx('espessura');
        const idxDeposito = getIdx('deposito');
        const idxDescricao = getIdx('descricao');
        const idxOrdemVenda = getIdx('ordemvenda');
        const idxCentro = getIdx('centro');

        if (idxLote === -1) {
          abrirAlerta('Erro', 'A coluna "Lote" é obrigatória e não foi encontrada no arquivo.');
          setCarregandoAcao(false);
          return;
        }

        let codigosExtraidos = [];
        for (let i = idxCabecalho + 1; i < linhas.length; i++) {
          const colunas = parseCSVLine(linhas[i]);
          if (colunas.length > idxLote) {
            const lote = colunas[idxLote];
            if (lote && lote !== '') {

              let filialLida = idxCentro !== -1 ? colunas[idxCentro] : null;
              if (!filialLida || filialLida.trim() === '') {
                filialLida = determinarFilial(lote);
              }

              codigosExtraidos.push({
                lote: lote,
                material: idxMaterial !== -1 ? colunas[idxMaterial] : null,
                ordem_producao: idxOrdem !== -1 ? colunas[idxOrdem] : null,
                cliente: idxCliente !== -1 ? colunas[idxCliente] : null,
                nome_cliente: idxNomeCliente !== -1 ? colunas[idxNomeCliente] : null,
                peso_liquido: idxPesoLiquido !== -1 ? colunas[idxPesoLiquido] : null,
                largura: idxLargura !== -1 ? colunas[idxLargura] : null,
                espessura: idxEspessura !== -1 ? colunas[idxEspessura] : null,
                deposito: idxDeposito !== -1 ? colunas[idxDeposito] : null,
                descricao: idxDescricao !== -1 ? colunas[idxDescricao] : null,
                ordem_venda: idxOrdemVenda !== -1 ? colunas[idxOrdemVenda] : null,
                filial: filialLida
              });
            }
          }
        }

        const idSessaoAtiva = await garantirSessao();

        const dadosParaBanco = codigosExtraidos.map(item => ({
          sessao_id: idSessaoAtiva,
          lote: item.lote,
          material: limparValorParaBanco(item.material),
          ordem_producao: limparValorParaBanco(item.ordem_producao),
          cliente: limparValorParaBanco(item.cliente),
          nome_cliente: limparValorParaBanco(item.nome_cliente),
          peso_liquido: limparNumeroParaBanco(item.peso_liquido),
          largura: limparNumeroParaBanco(item.largura),
          espessura: limparNumeroParaBanco(item.espessura),
          deposito: limparValorParaBanco(item.deposito),
          descricao: limparValorParaBanco(item.descricao),
          ordem_venda: limparValorParaBanco(item.ordem_venda),
          filial: limparValorParaBanco(item.filial)
        }));

        const { error } = await supabase.from('bobinas_sap').insert(dadosParaBanco);

        if (error) {
          throw error;
        }

        setCsvBobinas(codigosExtraidos);
        abrirAlerta('Sucesso', `${codigosExtraidos.length} bobinas esperadas importadas e salvas no banco!`);

      } catch (erro) {
        console.error(erro);
        abrirAlerta('Erro no Banco de Dados', erro.message || JSON.stringify(erro));
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
        setCarregandoAcao(false);
      }
    };
    reader.readAsText(file, 'ISO-8859-1');
  }

  const adicionarBobina = async (codigoCopia = null) => {
    const textoLido = (typeof codigoCopia === 'string' ? codigoCopia : codigo).trim();
    if (!textoLido) return;

    const textoLimpo = textoLido.toUpperCase().replace(/[\r\n\t]+/g, ' ');
    const regexValidos = /(RA|MA|VA)\d+/g;
    let lotesExtraidos = textoLimpo.match(regexValidos) || [];

    lotesExtraidos = [...new Set(lotesExtraidos)];

    if (lotesExtraidos.length === 0) {
      abrirAlerta('Atenção', 'Não foi possível encontrar códigos válidos (RA, MA, VA) nesta leitura.');
      setCodigo('');
      return;
    }

    setCarregandoAcao(true);

    try {
      const idSessaoAtiva = await garantirSessao();
      let listaAtualizada = [...bobinasLidas];

      let lotesSucessoSAP = [];
      let avisos = [];

      for (const lote of lotesExtraidos) {
        const loteLimpo = lote.trim();
        if (!loteLimpo) continue;

        if (listaAtualizada.some(b => b.codigo === loteLimpo)) {
          avisos.push(`⚠️ A bobina ${loteLimpo} já foi lida.`);
          continue;
        }

        const bobinaSAP = csvBobinas.find(c => c.lote === loteLimpo);
        const filialMapeada = determinarFilial(loteLimpo) || (bobinaSAP ? bobinaSAP.filial : null);
        const depositoEncontrado = bobinaSAP ? bobinaSAP.deposito : null;

        const { error } = await supabase
          .from('bobinas_lidas')
          .insert([{
            sessao_id: idSessaoAtiva,
            lote: loteLimpo,
            cracha_leitura: crachaLogado,
            filial: filialMapeada,
            deposito: depositoEncontrado
          }]);

        if (error) throw error;

        if (bobinaSAP) {
          lotesSucessoSAP.push(loteLimpo);
        } else {
          avisos.push(`⚠️ Bobina ${loteLimpo} lida, mas NÃO está no SAP.`);
        }

        const novaBobina = {
          codigo: loteLimpo,
          dataHora: new Date().toLocaleString('pt-BR'),
          cracha: crachaLogado,
          nome: nomeLogado,
          filial: filialMapeada,
          deposito: depositoEncontrado
        };

        listaAtualizada = [novaBobina, ...listaAtualizada];
      }

      setBobinasLidas(listaAtualizada);
      setCodigo('');
      setUsandoCamera(false);

      if (lotesSucessoSAP.length > 0 && avisos.length === 0) {
        abrirAlerta(
          '✅ Leitura OK!',
          `${lotesSucessoSAP.length} bobina(s) validada(s):\n${lotesSucessoSAP.join(', ')}`
        );
      } else if (avisos.length > 0) {
        abrirAlerta('Atenção na Leitura', avisos.join('\n\n'));
      }

    } catch (erro) {
      console.error(erro);
      abrirAlerta('Erro', 'Falha ao salvar a leitura no banco de dados.');
    } finally {
      setCarregandoAcao(false);
    }
  }

  const processarLoteDrone = async (arrayDeTextosLidos) => {
    setUsandoDrone(false);
    if (arrayDeTextosLidos.length === 0) {
      abrirAlerta('Resultado do Drone', 'Nenhum QR Code válido foi encontrado no vídeo.');
      return;
    }

    setCarregandoAcao(true);
    let lotesFormatados = [];

    arrayDeTextosLidos.forEach(texto => {
      const textoLimpo = texto.toUpperCase().replace(/[\r\n\t]+/g, ' ');
      const regexValidos = /(RA|MA|VA)\d+/g;

      const matches = textoLimpo.match(regexValidos);
      if (matches) {
        lotesFormatados.push(...matches);
      }
    });

    lotesFormatados = [...new Set(lotesFormatados)];

    try {
      const idSessaoAtiva = await garantirSessao();
      let listaAtualizada = [...bobinasLidas];
      let insercoesNoBanco = [];

      for (const lote of lotesFormatados) {
        if (!lote || listaAtualizada.some(b => b.codigo === lote)) continue;

        const bobinaSAP = csvBobinas.find(c => c.lote === lote);
        const filialMapeada = determinarFilial(lote) || (bobinaSAP ? bobinaSAP.filial : null);
        const depositoEncontrado = bobinaSAP ? bobinaSAP.deposito : null;

        const novaBobina = {
          codigo: lote,
          dataHora: new Date().toLocaleString('pt-BR'),
          cracha: crachaLogado,
          nome: nomeLogado,
          filial: filialMapeada,
          deposito: depositoEncontrado
        };
        listaAtualizada = [novaBobina, ...listaAtualizada];

        insercoesNoBanco.push({
          sessao_id: idSessaoAtiva,
          lote: lote,
          cracha_leitura: crachaLogado,
          filial: filialMapeada,
          deposito: depositoEncontrado
        });
      }

      if (insercoesNoBanco.length > 0) {
        const { error } = await supabase.from('bobinas_lidas').insert(insercoesNoBanco);
        if (error) throw error;
      }

      setBobinasLidas(listaAtualizada);
      abrirAlerta('Missão do Drone Concluída!', `Foram processados e inseridos ${insercoesNoBanco.length} novos lotes únicos no sistema com sucesso.`);
    } catch (erro) {
      abrirAlerta('Erro', 'Ocorreu um problema ao salvar os dados do drone.');
    } finally {
      setCarregandoAcao(false);
    }
  };

  const removerBobina = async (codigoParaRemover) => {
    setCarregandoAcao(true);

    try {
      if (sessaoId) {
        const { error } = await supabase
          .from('bobinas_lidas')
          .delete()
          .eq('sessao_id', sessaoId)
          .eq('lote', codigoParaRemover);

        if (error) throw error;
      }

      const novaLista = bobinasLidas.filter(b => b.codigo !== codigoParaRemover);
      setBobinasLidas(novaLista);

    } catch (erro) {
      console.error(erro);
      abrirAlerta('Erro', 'Falha ao excluir a bobina do banco de dados.');
    } finally {
      setCarregandoAcao(false);
    }
  }

  const limparDados = () => {
    abrirConfirmacao('Limpar Tela', 'Deseja limpar os dados da tela e iniciar uma nova contagem? (Os dados antigos permanecerão salvos no banco).', () => {
      setBobinasLidas([]);
      setCsvBobinas([]);
      setSessaoId(null);
    });
  }

  const obterRelatorioConciliado = () => {
    const lidasCodes = bobinasLidas.map(b => b.codigo);
    let relatorio = [];

    bobinasLidas.forEach(b => {
      const bobinaSAP = csvBobinas.find(c => c.lote === b.codigo);
      const isOk = !!bobinaSAP;

      const filialFinal = b.filial || (bobinaSAP ? bobinaSAP.filial : null) || determinarFilial(b.codigo) || '-';

      relatorio.push({
        codigo: b.codigo,
        status: csvBobinas.length === 0 ? 'Bipada (Sem SAP)' : (isOk ? 'OK (Lida)' : 'Não Consta no SAP'),
        dataHora: b.dataHora,
        cracha: b.cracha,
        nome_operador: b.nome,
        filial: filialFinal,
        deposito: b.deposito || (bobinaSAP ? (bobinaSAP.deposito || '-') : '-'),
        material: bobinaSAP ? bobinaSAP.material : '-',
        descricao: bobinaSAP ? bobinaSAP.descricao : '-',
        peso_liquido: bobinaSAP ? bobinaSAP.peso_liquido : '-',
        largura: bobinaSAP ? bobinaSAP.largura : '-',
        espessura: bobinaSAP ? bobinaSAP.espessura : '-',
        ordem_producao: bobinaSAP ? bobinaSAP.ordem_producao : '-',
        ordem_venda: bobinaSAP ? bobinaSAP.ordem_venda : '-',
        cliente: bobinaSAP ? bobinaSAP.cliente : '-',
        nome_cliente: bobinaSAP ? bobinaSAP.nome_cliente : '-',
        tipo: isOk ? 'ok' : 'sobrando'
      });
    });

    csvBobinas.forEach(c => {
      if (!lidasCodes.includes(c.lote)) {

        const filialFinal = c.filial || determinarFilial(c.lote) || '-';

        relatorio.push({
          codigo: c.lote,
          status: 'Faltando (Não Bipada)',
          dataHora: '-',
          cracha: '-',
          nome_operador: '-',
          filial: filialFinal,
          deposito: c.deposito || '-',
          material: c.material || '-',
          descricao: c.descricao || '-',
          peso_liquido: c.peso_liquido || '-',
          largura: c.largura || '-',
          espessura: c.espessura || '-',
          ordem_producao: c.ordem_producao || '-',
          ordem_venda: c.ordem_venda || '-',
          cliente: c.cliente || '-',
          nome_cliente: c.nome_cliente || '-',
          tipo: 'faltando'
        });
      }
    });

    return relatorio;
  }

  const gerarRelatorio = () => {
    const dados = obterRelatorioConciliado();
    if (dados.length === 0) {
      abrirAlerta('Vazio', 'Sem dados para gerar relatório.');
      return;
    }

    const limparParaCSV = (val) => {
      if (val === '-' || !val) return '-';
      let str = String(val);
      if (str.includes(';') || str.includes(',')) return `"${str}"`;
      return str;
    };

    let csvContent = "data:text/csv;charset=utf-8,\uFEFFLote;Material;Descricao;Filial;Deposito;Ordem Producao;Ordem Venda;Cliente;Nome Cliente;Peso Liquido;Largura;Espessura;Status;Data e Hora Leitura;Operador;Cracha\n"
      + dados.map(e => `${limparParaCSV(e.codigo)};${limparParaCSV(e.material)};${limparParaCSV(e.descricao)};${limparParaCSV(e.filial)};${limparParaCSV(e.deposito)};${limparParaCSV(e.ordem_producao)};${limparParaCSV(e.ordem_venda)};${limparParaCSV(e.cliente)};${limparParaCSV(e.nome_cliente)};${limparParaCSV(e.peso_liquido)};${limparParaCSV(e.largura)};${limparParaCSV(e.espessura)};${limparParaCSV(e.status)};${limparParaCSV(e.dataHora)};${limparParaCSV(e.nome_operador)};${limparParaCSV(e.cracha)}`).join("\n");

    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.download = `relatorio_inventario_${new Date().getTime()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  const relatorioNaTela = obterRelatorioConciliado();
  const qtdLidas = bobinasLidas.length;
  const qtdEsperadas = csvBobinas.length;
  const qtdFaltam = Math.max(0, qtdEsperadas - bobinasLidas.filter(b => csvBobinas.some(c => c.lote === b.codigo)).length);

  if (!crachaLogado) {
    return (
      <div className="min-vh-100 bg-light d-flex justify-content-center align-items-center position-relative px-3 py-4">
        {modal.show && (
          <div className="modal fade show d-block vp-modal-overlay" tabIndex="-1" style={{ zIndex: 1050 }}>
            <div className="modal-dialog modal-dialog-centered mx-3 mx-sm-auto">
              <div className="modal-content shadow border-0">
                <div className="modal-header border-0 bg-dark text-white">
                  <h5 className="modal-title fw-bold">Aviso</h5>
                  <button type="button" className="btn-close btn-close-white" onClick={fecharModal}></button>
                </div>
                <div className="modal-body p-4 fs-6 text-secondary text-center">
                  <p className="mb-0">{modal.message}</p>
                </div>
                <div className="modal-footer border-0 justify-content-center pb-4">
                  <button type="button" className="btn btn-secondary px-4 w-100 w-sm-auto" onClick={fecharModal}>Fechar</button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="card shadow-lg border-0 p-4 p-md-5 w-100" style={{ maxWidth: '450px', borderRadius: '12px' }}>
          <div className="text-center mb-4 mb-md-5">
            <img src={logoVideplast} alt="Videplast" className="img-fluid mb-4 logo-videplast-login" />
            <h4 className="fw-bold text-dark fs-5 fs-md-4">Videplast</h4>
            <p className="text-muted small mb-0">Controle de Estoque Videplast</p>
          </div>

          <div className="mb-4">
            <label className="form-label text-secondary fw-semibold small">Número do seu Crachá</label>
            <input
              type="number"
              className="form-control form-control-lg bg-light fs-6"
              placeholder="Ex: 123456"
              value={inputCracha}
              onChange={e => setInputCracha(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !carregandoLogin && fazerLogin()}
              autoFocus
              disabled={carregandoLogin}
            />
          </div>

          <button
            className="btn btn-primary btn-lg w-100 fw-bold shadow-sm d-flex align-items-center justify-content-center gap-2"
            onClick={fazerLogin}
            disabled={carregandoLogin}
            style={{ backgroundColor: '#cf0808ff', border: 'none', fontSize: '1rem' }}
          >
            {carregandoLogin ? (
              <><span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Validando...</>
            ) : 'Entrar no Sistema'}
          </button>
        </div>
      </div>
    );
  }

  // PROCESSAMENTO DE DADOS E FILTRAGEM
  let leiturasProcessadas = isAdmin
    ? leiturasGlobais
    : bobinasLidas.map(b => {
      const bSap = csvBobinas.find(c => c.lote === b.codigo);
      const filialFinal = b.filial || (bSap ? bSap.filial : null) || determinarFilial(b.codigo) || '-';

      return {
        ...b,
        codigo: b.codigo,
        filial: filialFinal,
        deposito: b.deposito || (bSap ? (bSap.deposito || '-') : '-'),
        material: bSap ? (bSap.material || '-') : '-',
        descricao: bSap ? (bSap.descricao || '-') : '-',
        peso_liquido: bSap ? (bSap.peso_liquido || '-') : '-',
        largura: bSap ? (bSap.largura || '-') : '-',
        espessura: bSap ? (bSap.espessura || '-') : '-',
        ordem_producao: bSap ? (bSap.ordem_producao || '-') : '-',
        ordem_venda: bSap ? (bSap.ordem_venda || '-') : '-',
        cliente: bSap ? (bSap.cliente || '-') : '-',
        nome_cliente: bSap ? (bSap.nome_cliente || '-') : '-'
      };
    });

  if (conferenciaFilters.lote) {
    leiturasProcessadas = leiturasProcessadas.filter(b =>
      b.codigo.toLowerCase().includes(conferenciaFilters.lote.toLowerCase())
    );
  }

  if (conferenciaFilters.data_leitura) {
    leiturasProcessadas = leiturasProcessadas.filter(b =>
      b.dataHora.includes(conferenciaFilters.data_leitura)
    );
  }

  if (conferenciaFilters.filial) {
    leiturasProcessadas = leiturasProcessadas.filter(b =>
      String(b.filial) === conferenciaFilters.filial
    );
  }

  if (conferenciaFilters.deposito) {
    leiturasProcessadas = leiturasProcessadas.filter(b =>
      String(b.deposito).toUpperCase().includes(conferenciaFilters.deposito.toUpperCase())
    );
  }

  // LÓGICA DE ORDENAÇÃO
  leiturasProcessadas.sort((a, b) => {
    if (conferenciaSort.field === 'Lote') {
      const valA = a.codigo || '';
      const valB = b.codigo || '';
      if (valA < valB) return conferenciaSort.order === 'asc' ? -1 : 1;
      if (valA > valB) return conferenciaSort.order === 'asc' ? 1 : -1;
      return 0;
    } else {
      const converterParaData = (dataStr) => {
        if (!dataStr || dataStr === '-') return 0;
        const partes = dataStr.match(/\d+/g);
        if (partes && partes.length >= 3) {
          const [dia, mes, ano, hora, min, sec] = partes;
          return new Date(ano, mes - 1, dia, hora || 0, min || 0, sec || 0).getTime();
        }
        return 0;
      };

      const tempoA = converterParaData(a.dataHora);
      const tempoB = converterParaData(b.dataHora);

      if (tempoA < tempoB) return conferenciaSort.order === 'asc' ? -1 : 1;
      if (tempoA > tempoB) return conferenciaSort.order === 'asc' ? 1 : -1;
      return 0;
    }
  });

  // ==========================================
  // LÓGICA DE PAGINAÇÃO (LIMITADOR DE CARGA DOM)
  // ==========================================
  const totalPaginas = Math.ceil(leiturasProcessadas.length / ITENS_POR_PAGINA) || 1;

  // Impede que a página atual seja maior que o total de páginas (ocorre quando filtramos e a lista diminui)
  const paginaCorrigida = Math.min(paginaAtual, totalPaginas);

  const indexUltimoItem = paginaCorrigida * ITENS_POR_PAGINA;
  const indexPrimeiroItem = indexUltimoItem - ITENS_POR_PAGINA;

  // Corta o array para exibir apenas os 50 itens da página atual
  const leiturasPaginadas = leiturasProcessadas.slice(indexPrimeiroItem, indexUltimoItem);

  return (
    <div className="min-vh-100 bg-light d-flex flex-column justify-content-top align-items-center position-relative pb-5">
      {modal.show && (
        <div className="modal fade show d-block vp-modal-overlay" tabIndex="-1" style={{ zIndex: 1050 }}>
          <div className="modal-dialog modal-dialog-centered mx-3 mx-sm-auto">
            <div className="modal-content shadow border-0" style={{ borderRadius: '8px', overflow: 'hidden' }}>
              <div className={`modal-header border-0 ${modal.type === 'confirm' ? 'bg-danger text-white' : 'bg-dark text-white'}`}>
                <h5 className="modal-title fw-bold fs-6">
                  {modal.type === 'confirm' && <i className="bi bi-exclamation-triangle-fill me-2"></i>}
                  {modal.title}
                </h5>
                <button type="button" className="btn-close btn-close-white" onClick={fecharModal}></button>
              </div>
              <div className="modal-body p-4 fs-6 text-secondary text-center">
                <p className="mb-0">{modal.message}</p>
              </div>
              <div className="modal-footer border-0 justify-content-center pb-4 flex-column flex-sm-row gap-2">
                <button type="button" className="btn btn-secondary px-4 w-100 w-sm-auto m-0" onClick={fecharModal}>
                  {modal.type === 'confirm' ? 'Cancelar' : 'Fechar'}
                </button>
                {modal.type === 'confirm' && (
                  <button type="button" className="btn btn-danger px-4 w-100 w-sm-auto m-0" onClick={modal.onConfirm}>Sim</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CONFERÊNCIA COM PAGINAÇÃO */}
      {showConferencia && (
        <div className="modal fade show d-block vp-modal-overlay" tabIndex="-1" style={{ zIndex: 1050 }}>
          <div className="modal-dialog modal-dialog-centered modal-xl mx-3 mx-sm-auto">
            <div className="modal-content shadow border-0" style={{ borderRadius: '8px', overflow: 'hidden' }}>
              <div className="modal-header border-0 bg-dark text-white">
                <h5 className="modal-title fw-bold fs-6">
                  Conferência de Leituras (Histórico Geral)
                </h5>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowConferencia(false)}></button>
              </div>
              <div className="modal-body p-4 fs-6 text-secondary">
                <p className="mb-2 text-center">
                  Operador responsável: <strong className="text-danger">{crachaLogado}</strong>
                  <br />
                  <span className="small text-muted">Exibindo {leiturasProcessadas.length} resultados encontrados.</span>
                </p>

                <FilterControls
                  filters={conferenciaFilters}
                  onFilterChange={setConferenciaFilters}
                  onResetFilters={() => setConferenciaFilters({ lote: '', data_leitura: '', filial: '', deposito: '' })}
                  sortConfig={conferenciaSort}
                  onSortChange={setConferenciaSort}
                  itemsCount={leiturasProcessadas.length}
                />

                <div className="row g-2 mb-3 mt-1">
                  <div className="col-12 col-sm-6">
                    <label className="form-label small fw-semibold text-secondary mb-1">Filtrar por Filial</label>
                    <select
                      className="form-select form-select-sm"
                      value={conferenciaFilters.filial}
                      onChange={e => setConferenciaFilters(prev => ({ ...prev, filial: e.target.value }))}
                    >
                      <option value="">Todas as Filiais</option>
                      <option value="1001">1001 (VA)</option>
                      <option value="1003">1003 (MA)</option>
                      <option value="1005">1005 (RA)</option>
                    </select>
                  </div>
                  <div className="col-12 col-sm-6">
                    <label className="form-label small fw-semibold text-secondary mb-1">Filtrar por Depósito</label>
                    <select
                      className="form-select form-select-sm"
                      value={conferenciaFilters.deposito}
                      onChange={e => setConferenciaFilters(prev => ({ ...prev, deposito: e.target.value }))}
                    >
                      <option value="">Todos os Depósitos</option>
                      <option value="P004">P004</option>
                      <option value="P030">P030</option>
                      <option value="P040">P040</option>
                    </select>
                  </div>
                </div>

                {/* VISTA DE COMPUTADOR: Tabela Clássica com Paginação */}
                <div className="table-responsive border rounded d-none d-md-block" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  <table className="table table-hover text-center align-middle mb-0">
                    <thead className="table-light sticky-top" style={{ top: 0, zIndex: 1 }}>
                      <tr>
                        <th className="py-2">Código da Bobina</th>
                        {isAdmin && <th className="py-2">Operador</th>}
                        <th className="py-2">Data e Hora</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leiturasPaginadas.length === 0 ? (
                        <tr>
                          <td colSpan={isAdmin ? 3 : 2} className="text-muted py-4">
                            Nenhuma leitura encontrada com esses filtros.
                          </td>
                        </tr>
                      ) : (
                        leiturasPaginadas.map((leitura, index) => {
                          const confKey = `${leitura.codigo}_conf_${index}`;
                          const expandido = lotesExpandidos[confKey];
                          return (
                            <React.Fragment key={index}>
                              <tr onClick={() => toggleLoteExpandido(confKey)} style={{ cursor: 'pointer' }}>
                                <td className="fw-bold text-primary">
                                  <i className={`bi bi-chevron-${expandido ? 'down' : 'right'} me-2 text-secondary`}></i>
                                  <span className="vp-mono">{leitura.codigo}</span>
                                </td>
                                {isAdmin && <td>{leitura.nome || leitura.cracha}</td>}
                                <td>{leitura.dataHora}</td>
                              </tr>
                              {expandido && (
                                <tr>
                                  <td colSpan={isAdmin ? 3 : 2} className="p-0 border-0">
                                    <div className="p-3 bg-light text-start border-bottom small text-dark animate__animated animate__fadeIn">
                                      <div className="row g-2">
                                        <div className="col-12 col-md-6">
                                          <strong>Material & Descrição:</strong> {leitura.material} - {leitura.descricao}
                                        </div>
                                        <div className="col-6 col-md-3">
                                          <strong>Depósito:</strong> {leitura.deposito}
                                        </div>
                                        <div className="col-6 col-md-3">
                                          <strong>Filial:</strong> {leitura.filial}
                                        </div>
                                        <div className="col-6 col-md-4">
                                          <strong>Peso Líquido:</strong> {leitura.peso_liquido !== '-' ? `${leitura.peso_liquido} kg` : '-'}
                                        </div>
                                        <div className="col-6 col-md-4">
                                          <strong>Dimensões:</strong> {leitura.largura !== '-' && leitura.espessura !== '-' ? `${leitura.largura}mm x ${leitura.espessura}µm` : '-'}
                                        </div>
                                        <div className="col-6 col-md-4">
                                          <strong>OP / OV:</strong> OP: {leitura.ordem_producao} / OV: {leitura.ordem_venda}
                                        </div>
                                        <div className="col-12">
                                          <strong>Cliente:</strong> {leitura.cliente} - {leitura.nome_cliente}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* VISTA DE TELEMÓVEL: Cartões Responsivos com Paginação */}
                <div className="d-md-none" style={{ maxHeight: '60vh', overflowY: 'auto', margin: '-1rem', padding: '1rem', backgroundColor: '#f8f9fa' }}>
                  <div className="vp-mobile-cards-list">
                    {leiturasPaginadas.length === 0 ? (
                      <div className="text-center text-muted py-4">Nenhuma leitura encontrada com esses filtros.</div>
                    ) : (
                      leiturasPaginadas.map((leitura, index) => {
                        const confKey = `${leitura.codigo}_conf_${index}`;
                        const expandido = lotesExpandidos[confKey];
                        return (
                          <div key={index} className={`vp-mobile-report-card ok ${expandido ? 'expanded' : ''}`} onClick={() => toggleLoteExpandido(confKey)} style={{ cursor: 'pointer' }}>
                            <div className="vp-mobile-card-header">
                              <span className="vp-mobile-card-lote">
                                <i className={`bi bi-chevron-${expandido ? 'down' : 'right'} me-2 text-secondary`}></i>
                                <i className="bi bi-box-seam me-1 text-primary"></i> <span className="vp-mono">{leitura.codigo}</span>
                              </span>
                            </div>
                            <div className="vp-mobile-card-body">
                              <div className="vp-mobile-card-details">
                                <div className="vp-detail-item">
                                  <span className="vp-detail-label">Data/Hora:</span>
                                  <span className="vp-detail-value">{leitura.dataHora}</span>
                                </div>
                                {isAdmin && (
                                  <div className="vp-detail-item mt-1">
                                    <span className="vp-detail-label">Operador:</span>
                                    <span className="vp-detail-value">{leitura.nome || leitura.cracha}</span>
                                  </div>
                                )}
                              </div>
                              {expandido && (
                                <div className="vp-mobile-card-extra border-top pt-2 mt-2">
                                  <div className="vp-detail-block mb-2">
                                    <span className="vp-detail-label">Material & Descrição</span>
                                    <div className="vp-detail-val small fw-semibold text-dark">{leitura.material} - {leitura.descricao}</div>
                                  </div>
                                  <div className="row g-2 mb-2">
                                    <div className="col-6">
                                      <div className="vp-detail-block">
                                        <span className="vp-detail-label">Depósito</span>
                                        <div className="vp-detail-val small fw-semibold text-dark">{leitura.deposito}</div>
                                      </div>
                                    </div>
                                    <div className="col-6">
                                      <div className="vp-detail-block">
                                        <span className="vp-detail-label">Filial</span>
                                        <div className="vp-detail-val small fw-semibold text-dark">{leitura.filial}</div>
                                      </div>
                                    </div>
                                    <div className="col-6">
                                      <div className="vp-detail-block">
                                        <span className="vp-detail-label">Peso Líquido</span>
                                        <div className="vp-detail-val small fw-semibold text-dark">{leitura.peso_liquido !== '-' ? `${leitura.peso_liquido} kg` : '-'}</div>
                                      </div>
                                    </div>
                                    <div className="col-6">
                                      <div className="vp-detail-block">
                                        <span className="vp-detail-label">Dimensões</span>
                                        <div className="vp-detail-val small fw-semibold text-dark">{leitura.largura !== '-' && leitura.espessura !== '-' ? `${leitura.largura}mm x ${leitura.espessura}µm` : '-'}</div>
                                      </div>
                                    </div>
                                    <div className="col-12">
                                      <div className="vp-detail-block">
                                        <span className="vp-detail-label">OP / OV</span>
                                        <div className="vp-detail-val small fw-semibold text-dark">{leitura.ordem_producao} / {leitura.ordem_venda}</div>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="vp-detail-block">
                                    <span className="vp-detail-label">Cliente</span>
                                    <div className="vp-detail-val small fw-semibold text-dark">{leitura.cliente} - {leitura.nome_cliente}</div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>

                {/* CONTROLOS DE PAGINAÇÃO (Aparecem apenas se houver mais de uma página) */}
                {totalPaginas > 1 && (
                  <div className="d-flex justify-content-between align-items-center mt-3 pt-3 border-top">
                    <button
                      className="btn btn-outline-secondary btn-sm px-3"
                      onClick={() => setPaginaAtual(prev => Math.max(prev - 1, 1))}
                      disabled={paginaAtual === 1}
                    >
                      <i className="bi bi-chevron-left me-1"></i> Anterior
                    </button>
                    <span className="small text-muted fw-semibold">
                      Página {paginaCorrigida} de {totalPaginas}
                    </span>
                    <button
                      className="btn btn-outline-secondary btn-sm px-3"
                      onClick={() => setPaginaAtual(prev => Math.min(prev + 1, totalPaginas))}
                      disabled={paginaAtual === totalPaginas}
                    >
                      Próxima <i className="bi bi-chevron-right ms-1"></i>
                    </button>
                  </div>
                )}

              </div>
              <div className="modal-footer border-0 justify-content-center pb-4">
                <button type="button" className="btn btn-secondary px-4 w-100 w-sm-auto" onClick={() => setShowConferencia(false)}>
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="container px-3 px-md-0 pt-2 pb-5" style={{ maxWidth: '800px', width: '100%' }}>
        <Header />

        <div className="vp-operator-card animate__animated animate__fadeIn mb-4">
          <div className="vp-operator-info">
            <div className="vp-operator-avatar">
              {obterIniciais(nomeLogado)}
            </div>
            <div>
              <span className="vp-micro-label" style={{ margin: 0 }}>Operador Logado</span>
              <h4 className="vp-operator-name">{nomeLogado}</h4>
              <span className="vp-operator-badge"><i className="bi bi-person-badge"></i> {crachaLogado}</span>
            </div>
          </div>

          <div className="vp-operator-actions">
            <button className="vp-btn vp-btn-outline" onClick={abrirConferenciaAdmin} disabled={carregandoAcao}>
              <i className="bi bi-list-check"></i> Conferência
            </button>
            <button className="vp-btn vp-btn-ghost-danger" onClick={fazerLogout} disabled={carregandoAcao}>
              <i className="bi bi-box-arrow-right"></i> Sair
            </button>
          </div>
        </div>

        <main>
          <div className="vp-card vp-sap-card no-hover animate__animated animate__fadeIn mb-4">
            <div className="vp-sap-info">
              <div className="vp-sap-icon">
                <i className="bi bi-filetype-csv"></i>
              </div>
              <div>
                <h3 className="vp-title">Base do SAP (CSV)</h3>
                <p className="vp-subtitle">Importe a planilha oficial gerada pelo sistema SAP.</p>
              </div>
            </div>
            <div className="w-100 w-sm-auto">
              <input type="file" accept=".csv" className="d-none" ref={fileInputRef} onChange={importarCSV} id="csvUpload" disabled={carregandoAcao} />
              <label htmlFor="csvUpload" className={`vp-btn vp-btn-outline w-100 w-sm-auto d-flex justify-content-center align-items-center gap-2 ${carregandoAcao ? 'disabled' : ''}`} style={{ height: '44px' }}>
                {carregandoAcao ? (
                  <span className="spinner-border spinner-border-sm" role="status"></span>
                ) : (
                  <i className="bi bi-cloud-upload"></i>
                )}
                {carregandoAcao ? 'Salvando...' : 'Importar SAP'}
              </label>
            </div>
          </div>

          {usandoDrone ? (
            <ProcessadorDrone
              aoConcluir={processarLoteDrone}
              aoCancelar={() => setUsandoDrone(false)}
            />
          ) : usandoCamera ? (
            <Scanner aoLerCodigo={adicionarBobina} aoCancelar={() => setUsandoCamera(false)} />
          ) : (
            <div className="vp-card no-hover mb-4" style={{ margin: 0 }}>
              <h2 className="vp-title">Bipar Bobina</h2>
              <p className="vp-subtitle" style={{ marginBottom: '1.25rem' }}>Utilize o leitor conectado, a câmera do celular ou processe em lote via drone.</p>

              <div className="vp-input-group mb-3">
                <textarea
                  ref={inputRef}
                  className="vp-input"
                  placeholder="Bipe ou digite os códigos (espaço, vírgula ou Enter)..."
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (!carregandoAcao) adicionarBobina();
                    }
                  }}
                  disabled={carregandoAcao}
                  rows={2}
                />
                <button
                  className="vp-btn vp-btn-primary"
                  onClick={() => adicionarBobina()}
                  disabled={carregandoAcao}
                  style={{ padding: '0 1.75rem' }}
                >
                  <i className="bi bi-plus-lg"></i> Adicionar
                </button>
              </div>

              <div className="vp-scanner-actions">
                <button className="vp-btn vp-btn-dark flex-grow-1" onClick={() => setUsandoCamera(true)} disabled={carregandoAcao}>
                  <i className="bi bi-camera"></i> Câmera Celular
                </button>
                <button className="vp-btn vp-btn-outline flex-grow-1" style={{ borderColor: 'var(--vp-orange)', color: 'var(--vp-orange)' }} onClick={() => setUsandoDrone(true)} disabled={carregandoAcao}>
                  <i className="bi bi-send-check"></i> Processar Drone
                </button>
              </div>
            </div>
          )}

          <div className="vp-counters-container animate__animated animate__fadeIn mb-4">
            <div className="vp-counter-card esperadas">
              <div className="vp-counter-header">
                <span className="vp-counter-label">Esperadas</span>
                <i className="bi bi-calculator"></i>
              </div>
              <h3 className="vp-counter-value">{qtdEsperadas}</h3>
            </div>

            <div className="vp-counter-card lidas">
              <div className="vp-counter-header">
                <span className="vp-counter-label">Lidas</span>
                <i className="bi bi-check-circle"></i>
              </div>
              <h3 className="vp-counter-value">{qtdLidas}</h3>
            </div>

            <div className="vp-counter-card faltam">
              <div className="vp-counter-header">
                <span className="vp-counter-label">Faltam</span>
                <i className="bi bi-exclamation-circle"></i>
              </div>
              <h3 className="vp-counter-value">{qtdFaltam}</h3>
            </div>
          </div>

          <div className="vp-bottom-actions animate__animated animate__fadeIn mb-4">
            <button onClick={gerarRelatorio} className="vp-btn vp-btn-outline w-100 py-3 fw-semibold gap-2" style={{ borderColor: 'var(--vp-green)', color: 'var(--vp-green)', height: '52px' }}>
              <i className="bi bi-file-earmark-spreadsheet fs-5"></i> Exportar Relatório Conciliado
            </button>

            <button onClick={limparDados} className="vp-btn vp-btn-ghost-danger w-100 py-3 text-decoration-none gap-2" style={{ height: '52px', marginTop: '0.25rem' }}>
              <i className="bi bi-arrow-counterclockwise fs-5"></i> Iniciar Novo Inventário
            </button>
          </div>

          {relatorioNaTela.length > 0 && (
            <>
              {/* DESKTOP TABLE VIEW */}
              <div className="vp-desktop-table-wrapper card shadow-sm border-0 mb-4 animate__animated animate__fadeIn overflow-hidden">
                <div className="card-body p-0 table-responsive">
                  <table className="table table-hover mb-0 text-center align-middle" style={{ whiteSpace: 'nowrap' }}>
                    <thead className="table-dark">
                      <tr>
                        <th className="py-3 px-3 text-start text-sm-center" style={{ width: '40%' }}>Lote/Código</th>
                        <th className="py-3 px-3" style={{ width: '40%' }}>Status</th>
                        <th className="py-3 px-3" style={{ width: '20%' }}>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relatorioNaTela.map((item, idx) => {
                        const expandido = lotesExpandidos[item.codigo];
                        return (
                          <React.Fragment key={idx}>
                            <tr
                              className={`vp-table-row-main ${item.tipo === 'faltando' ? 'table-danger opacity-75' : ''} ${expandido ? 'vp-row-expanded' : ''}`}
                              onClick={() => toggleLoteExpandido(item.codigo)}
                              style={{ cursor: 'pointer' }}
                            >
                              <td className="fw-bold py-3 px-3 text-start text-sm-center">
                                <i className={`bi bi-chevron-${expandido ? 'down' : 'right'} me-2 text-secondary`}></i>
                                <span className="vp-mono">{item.codigo}</span>
                              </td>
                              <td className="px-3">
                                {item.tipo === 'ok' && <span className="badge bg-success w-100 py-2">OK (Lida)</span>}
                                {item.tipo === 'faltando' && <span className="badge bg-danger w-100 py-2">Faltando</span>}
                                {item.tipo === 'sobrando' && <span className="badge bg-warning text-dark w-100 py-2">Sobra</span>}
                                {!item.tipo && <span className="badge bg-secondary w-100 py-2">{item.status}</span>}
                              </td>
                              <td className="px-3" onClick={(e) => e.stopPropagation()}>
                                {item.tipo !== 'faltando' && (
                                  <button
                                    className="btn btn-sm btn-outline-danger border-0"
                                    onClick={() => removerBobina(item.codigo)}
                                    title="Excluir leitura"
                                    disabled={carregandoAcao}
                                  >
                                    <i className="bi bi-trash fs-5"></i>
                                  </button>
                                )}
                              </td>
                            </tr>
                            {expandido && (
                              <tr className="vp-table-row-details">
                                <td colSpan="3" className="p-0 border-0">
                                  <div className="vp-row-details-content p-3 bg-light text-start border-bottom">
                                    <div className="row g-3">
                                      <div className="col-12 col-md-6">
                                        <div className="vp-detail-block">
                                          <span className="vp-detail-label">Material & Descrição</span>
                                          <div className="vp-detail-val fw-semibold text-dark">{item.material || '-'} - {item.descricao || '-'}</div>
                                        </div>
                                      </div>
                                      <div className="col-6 col-md-3">
                                        <div className="vp-detail-block">
                                          <span className="vp-detail-label">Depósito / Armazém</span>
                                          <div className="vp-detail-val fw-semibold text-dark">{item.deposito || '-'}</div>
                                        </div>
                                      </div>
                                      <div className="col-6 col-md-3">
                                        <div className="vp-detail-block">
                                          <span className="vp-detail-label">Filial</span>
                                          <div className="vp-detail-val fw-semibold text-dark">{item.filial || '-'}</div>
                                        </div>
                                      </div>
                                      <div className="col-6 col-md-4">
                                        <div className="vp-detail-block">
                                          <span className="vp-detail-label">Peso Líquido</span>
                                          <div className="vp-detail-val fw-semibold text-dark">{item.peso_liquido !== '-' ? `${item.peso_liquido} kg` : '-'}</div>
                                        </div>
                                      </div>
                                      <div className="col-6 col-md-4">
                                        <div className="vp-detail-block">
                                          <span className="vp-detail-label">Largura x Espessura</span>
                                          <div className="vp-detail-val fw-semibold text-dark">{item.largura !== '-' && item.espessura !== '-' ? `${item.largura} mm x ${item.espessura} µm` : '-'}</div>
                                        </div>
                                      </div>
                                      <div className="col-6 col-md-4">
                                        <div className="vp-detail-block">
                                          <span className="vp-detail-label">Ordem Produção / Venda</span>
                                          <div className="vp-detail-val fw-semibold text-dark">OP: {item.ordem_producao || '-'} / OV: {item.ordem_venda || '-'}</div>
                                        </div>
                                      </div>
                                      <div className="col-12">
                                        <div className="vp-detail-block">
                                          <span className="vp-detail-label">Cliente</span>
                                          <div className="vp-detail-val fw-semibold text-dark">{item.cliente || '-'} - {item.nome_cliente || '-'}</div>
                                        </div>
                                      </div>
                                      {item.tipo !== 'faltando' && (
                                        <div className="col-12 border-top pt-2 mt-2">
                                          <small className="text-muted">
                                            <i className="bi bi-clock me-1"></i>
                                            {item.dataHora !== '-' ? `Bipada em ${item.dataHora} por ${item.nome_operador} (${item.cracha})` : 'Aguardando bipagem.'}
                                          </small>
                                        </div>
                                      )}
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

              {/* MOBILE CARDS VIEW */}
              <div className="vp-mobile-cards-list animate__animated animate__fadeIn">
                {relatorioNaTela.map((item, idx) => {
                  const expandido = lotesExpandidos[item.codigo];
                  return (
                    <div
                      key={idx}
                      className={`vp-mobile-report-card ${item.tipo || 'default'} ${expandido ? 'expanded' : ''}`}
                      onClick={() => toggleLoteExpandido(item.codigo)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="vp-mobile-card-header">
                        <span className="vp-mobile-card-lote">
                          <i className={`bi bi-chevron-${expandido ? 'down' : 'right'} me-2 text-secondary`}></i>
                          <i className="bi bi-box-seam me-1 text-primary"></i> <span className="vp-mono">{item.codigo}</span>
                        </span>
                        <div className="vp-mobile-card-actions" onClick={(e) => e.stopPropagation()}>
                          {item.tipo !== 'faltando' && (
                            <button
                              className="vp-btn-delete"
                              onClick={() => removerBobina(item.codigo)}
                              disabled={carregandoAcao}
                              title="Excluir leitura"
                            >
                              <i className="bi bi-trash"></i>
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="vp-mobile-card-body">
                        <div className="vp-mobile-card-row">
                          <span className="vp-mobile-card-label">Status:</span>
                          <span className={`vp-mobile-card-badge ${item.tipo || 'default'}`}>
                            {item.tipo === 'ok' && 'Lida / SAP OK'}
                            {item.tipo === 'faltando' && 'Faltando (Não Bipada)'}
                            {item.tipo === 'sobrando' && 'Sobrando (Não SAP)'}
                            {!item.tipo && item.status}
                          </span>
                        </div>

                        <div className="vp-mobile-card-details">
                          {item.tipo !== 'faltando' && (
                            <>
                              <div className="vp-detail-item">
                                <span className="vp-detail-label">Data/Hora:</span>
                                <span className="vp-detail-value">{item.dataHora || '-'}</span>
                              </div>
                              <div className="vp-detail-item">
                                <span className="vp-detail-label">Operador:</span>
                                <span className="vp-detail-value">{item.nome_operador || '-'}</span>
                              </div>
                            </>
                          )}
                        </div>

                        {expandido && (
                          <div className="vp-mobile-card-extra border-top pt-2 mt-2">
                            <div className="vp-detail-block mb-2">
                              <span className="vp-detail-label">Material & Descrição</span>
                              <div className="vp-detail-val small fw-semibold text-dark">{item.material || '-'} - {item.descricao || '-'}</div>
                            </div>
                            <div className="row g-2 mb-2">
                              <div className="col-6">
                                <div className="vp-detail-block">
                                  <span className="vp-detail-label">Depósito</span>
                                  <div className="vp-detail-val small fw-semibold text-dark">{item.deposito || '-'}</div>
                                </div>
                              </div>
                              <div className="col-6">
                                <div className="vp-detail-block">
                                  <span className="vp-detail-label">Filial</span>
                                  <div className="vp-detail-val small fw-semibold text-dark">{item.filial || '-'}</div>
                                </div>
                              </div>
                              <div className="col-6">
                                <div className="vp-detail-block">
                                  <span className="vp-detail-label">Peso Líquido</span>
                                  <div className="vp-detail-val small fw-semibold text-dark">{item.peso_liquido !== '-' ? `${item.peso_liquido} kg` : '-'}</div>
                                </div>
                              </div>
                              <div className="col-6">
                                <div className="vp-detail-block">
                                  <span className="vp-detail-label">Dimensões</span>
                                  <div className="vp-detail-val small fw-semibold text-dark">{item.largura && item.espessura ? `${item.largura}mm x ${item.espessura}µm` : '-'}</div>
                                </div>
                              </div>
                              <div className="col-12">
                                <div className="vp-detail-block">
                                  <span className="vp-detail-label">OP / OV</span>
                                  <div className="vp-detail-val small fw-semibold text-dark">{item.ordem_producao || '-'} / {item.ordem_venda || '-'}</div>
                                </div>
                              </div>
                            </div>
                            <div className="vp-detail-block">
                              <span className="vp-detail-label">Cliente</span>
                              <div className="vp-detail-val small fw-semibold text-dark">{item.cliente || '-'} - {item.nome_cliente || '-'}</div>
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
        </main>
      </div>
    </div>
  )
}

export default App