import { useState, useRef, useEffect } from 'react'
import Header from './components/Header'
import Scanner from './components/Scanner'
import logoVideplast from './assets/videplast-brand.png'
import { supabase } from './supabase'
import './App.css'

function App() {
  // ESTADOS DE LOGIN
  const [crachaLogado, setCrachaLogado] = useState(() => sessionStorage.getItem('usuario_cracha') || '');
  const [nomeLogado, setNomeLogado] = useState(() => sessionStorage.getItem('usuario_nome') || '');
  const [inputCracha, setInputCracha] = useState('');
  const [carregandoLogin, setCarregandoLogin] = useState(false);

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
    } else {
      sessionStorage.removeItem('usuario_cracha');
      sessionStorage.removeItem('usuario_nome');
    }
  }, [crachaLogado, nomeLogado]);

  useEffect(() => {
    if(crachaLogado && inputRef.current && !modal.show && !usandoCamera) {
      inputRef.current.focus();
    }
  }, [crachaLogado, modal.show, usandoCamera]);

  // FUNÇÕES DE MODAL
  const fecharModal = () => setModal({ ...modal, show: false });
  
  const abrirAlerta = (titulo, mensagem) => {
    setModal({ show: true, title: titulo, message: mensagem, type: 'alert', onConfirm: null });
  }
  
  const abrirConfirmacao = (titulo, mensagem, acaoConfirmar) => {
    setModal({
      show: true, title: titulo, message: mensagem, type: 'confirm',
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
        .select('id, nome_completo') 
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
        for(let i=0; i < Math.min(10, linhas.length); i++){
           if(linhas[i].toLowerCase().includes('lote')) {
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
                ordem_venda: idxOrdemVenda !== -1 ? colunas[idxOrdemVenda] : null
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
          ordem_venda: limparValorParaBanco(item.ordem_venda)
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
        if(fileInputRef.current) fileInputRef.current.value = ''; 
        setCarregandoAcao(false);
      }
    };
    reader.readAsText(file, 'ISO-8859-1'); 
  }

  const adicionarBobina = async (codigoCopia = null) => {
    const codParaAdicionar = (typeof codigoCopia === 'string' ? codigoCopia : codigo).trim();
    
    if (!codParaAdicionar) return;
    
    if (bobinasLidas.some(b => b.codigo === codParaAdicionar)) {
      abrirAlerta('Atenção', `A bobina ${codParaAdicionar} já foi lida.`);
      setCodigo('');
      return;
    }

    setCarregandoAcao(true);

    try {
      const idSessaoAtiva = await garantirSessao();
      const { error } = await supabase
        .from('bobinas_lidas')
        .insert([{ 
          sessao_id: idSessaoAtiva, 
          lote: codParaAdicionar, 
          cracha_leitura: crachaLogado 
        }]);

      if (error) throw error;

      const constaSistema = csvBobinas.some(c => c.lote === codParaAdicionar);
      if (!constaSistema && csvBobinas.length > 0) {
        abrirAlerta('Aviso de Divergência', `Bobina ${codParaAdicionar} salva, mas NÃO estava na lista do SAP.`);
      }

      const novaBobina = { 
        codigo: codParaAdicionar, 
        dataHora: new Date().toLocaleString('pt-BR'),
        cracha: crachaLogado,
        nome: nomeLogado
      };
      
      setBobinasLidas([novaBobina, ...bobinasLidas]);
      setCodigo('');
      setUsandoCamera(false); 

    } catch (erro) {
      console.error(erro);
      abrirAlerta('Erro', 'Falha ao salvar a leitura no banco de dados.');
    } finally {
      setCarregandoAcao(false);
    }
  }

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

      relatorio.push({
        codigo: b.codigo,
        status: csvBobinas.length === 0 ? 'Bipada (Sem SAP)' : (isOk ? 'OK (Lida)' : 'Não Consta no SAP'),
        dataHora: b.dataHora,
        cracha: b.cracha,
        nome_operador: b.nome,
        material: bobinaSAP ? bobinaSAP.material : '-',
        ordem_producao: bobinaSAP ? bobinaSAP.ordem_producao : '-',
        cliente: bobinaSAP ? bobinaSAP.cliente : '-',
        nome_cliente: bobinaSAP ? bobinaSAP.nome_cliente : '-',
        peso_liquido: bobinaSAP ? bobinaSAP.peso_liquido : '-', 
        largura: bobinaSAP ? bobinaSAP.largura : '-',           
        espessura: bobinaSAP ? bobinaSAP.espessura : '-',       
        deposito: bobinaSAP ? bobinaSAP.deposito : '-',         
        descricao: bobinaSAP ? bobinaSAP.descricao : '-',       
        ordem_venda: bobinaSAP ? bobinaSAP.ordem_venda : '-',   
        tipo: isOk ? 'ok' : 'sobrando'
      });
    });

    csvBobinas.forEach(c => {
      if (!lidasCodes.includes(c.lote)) {
        relatorio.push({
          codigo: c.lote,
          status: 'Faltando (Não Bipada)',
          dataHora: '-',
          cracha: '-',
          nome_operador: '-',
          material: c.material || '-',
          ordem_producao: c.ordem_producao || '-',
          cliente: c.cliente || '-',
          nome_cliente: c.nome_cliente || '-',
          peso_liquido: c.peso_liquido || '-', 
          largura: c.largura || '-',           
          espessura: c.espessura || '-',       
          deposito: c.deposito || '-',         
          descricao: c.descricao || '-',       
          ordem_venda: c.ordem_venda || '-',   
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
      if(val === '-' || !val) return '-';
      let str = String(val);
      if(str.includes(';') || str.includes(',')) return `"${str}"`;
      return str;
    };

    let csvContent = "data:text/csv;charset=utf-8,\uFEFFLote;Material;Descricao;Deposito;Ordem Producao;Ordem Venda;Cliente;Nome Cliente;Peso Liquido;Largura;Espessura;Status;Data e Hora Leitura;Operador;Cracha\n" 
      + dados.map(e => `${limparParaCSV(e.codigo)};${limparParaCSV(e.material)};${limparParaCSV(e.descricao)};${limparParaCSV(e.deposito)};${limparParaCSV(e.ordem_producao)};${limparParaCSV(e.ordem_venda)};${limparParaCSV(e.cliente)};${limparParaCSV(e.nome_cliente)};${limparParaCSV(e.peso_liquido)};${limparParaCSV(e.largura)};${limparParaCSV(e.espessura)};${limparParaCSV(e.status)};${limparParaCSV(e.dataHora)};${limparParaCSV(e.nome_operador)};${limparParaCSV(e.cracha)}`).join("\n");
      
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
          <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
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
            <img src={logoVideplast} alt="Videplast" className="img-fluid mb-4" style={{maxHeight: '60px'}} />
            <h4 className="fw-bold text-dark fs-5 fs-md-4">Inventário de Bobinas</h4>
            <p className="text-muted small mb-0">Identifique-se para iniciar a contagem</p>
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
            style={{backgroundColor: '#d80404', border: 'none', fontSize: '1rem'}}
          >
            {carregandoLogin ? (
              <><span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Validando...</>
            ) : 'Entrar no Sistema'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-vh-100 bg-light d-flex flex-column justify-content-top align-items-center position-relative pb-5">
      
      {modal.show && (
        <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
          <div className="modal-dialog modal-dialog-centered mx-3 mx-sm-auto">
            <div className="modal-content shadow border-0" style={{borderRadius: '8px', overflow: 'hidden'}}>
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

      <div className="container px-3 px-md-0 pt-3" style={{ maxWidth: '800px', width: '100%' }}>
        <Header />

        <div className="d-flex flex-column flex-sm-row justify-content-between align-items-start align-items-sm-center bg-white p-3 rounded shadow-sm border border-secondary border-opacity-10 mb-4 gap-3">
          <div>
            <span className="text-muted small d-block mb-1">Operador Logado</span>
            <span className="fw-bold text-dark fs-6">{nomeLogado} <span className="text-secondary fw-normal d-block d-sm-inline mt-1 mt-sm-0">- {crachaLogado}</span></span>
          </div>
          <button className="btn btn-outline-danger btn-sm w-100 w-sm-auto" onClick={fazerLogout}>
            Sair do Sistema
          </button>
        </div>

        <main>
          <div className="card shadow-sm border-0 mb-4 bg-white border border-secondary border-opacity-10">
            <div className="card-body p-3 p-md-4 d-flex flex-column flex-sm-row justify-content-between align-items-start align-items-sm-center gap-3">
              <div>
                <h6 className="mb-1 fw-bold text-dark">Base do SAP (CSV)</h6>
                <small className="text-muted">Importe o arquivo gerado pelo SAP.</small>
              </div>
              <div className="w-100 w-sm-auto">
                <input type="file" accept=".csv" className="d-none" ref={fileInputRef} onChange={importarCSV} id="csvUpload" disabled={carregandoAcao} />
                <label htmlFor="csvUpload" className={`btn btn-outline-secondary btn-sm w-100 w-sm-auto m-0 py-2 d-flex justify-content-center align-items-center gap-2 ${carregandoAcao ? 'disabled' : ''}`}>
                  {carregandoAcao ? <span className="spinner-border spinner-border-sm"></span> : '📁'} 
                  {carregandoAcao ? 'Salvando...' : 'Importar SAP'}
                </label>
              </div>
            </div>
          </div>

          {usandoCamera ? (
            <Scanner 
              aoLerCodigo={adicionarBobina} 
              aoCancelar={() => setUsandoCamera(false)} 
            />
          ) : (
            <div className="card shadow-sm border-0 mb-4">
              <div className="card-body p-3 p-md-4 text-center">
                <label htmlFor="inputBobina" className="form-label text-muted fw-semibold mb-3">
                  Leitura de Bobina
                </label>
                
                <div className="input-group input-group-lg shadow-sm mb-4">
                  <input
                    id="inputBobina"
                    ref={inputRef}
                    type="text"
                    className="form-control border-end-0 fs-6 bg-light"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !carregandoAcao && adicionarBobina()}
                    placeholder="Bipe ou digite..."
                    autoComplete="off"
                    disabled={carregandoAcao}
                  />
                  <button 
                    className="btn btn-primary px-3 px-md-4" 
                    style={{backgroundColor: '#d80404', border: 'none', fontSize: '0.95rem'}} 
                    onClick={() => adicionarBobina()}
                    disabled={carregandoAcao}
                  >
                    Adicionar
                  </button>
                </div>
                
                <button 
                  className="btn btn-dark d-flex align-items-center justify-content-center gap-2 mx-auto w-100 py-2"
                  onClick={() => setUsandoCamera(true)}
                  style={{maxWidth: '100%'}}
                  disabled={carregandoAcao}
                >
                  <i className="bi bi-camera fs-5"></i> Ler com a Câmera
                </button>
              </div>
            </div>
          )}

          <div className="row g-2 g-sm-3 mb-4 text-center">
            <div className="col-4">
              <div className="p-2 p-sm-3 bg-white rounded shadow-sm border-bottom border-secondary border-3 h-100 d-flex flex-column justify-content-center">
                <h6 className="text-muted mb-1" style={{fontSize: '0.75rem', textTransform: 'uppercase'}}>Esperadas</h6>
                <h5 className="mb-0 fw-bold">{qtdEsperadas}</h5>
              </div>
            </div>
            <div className="col-4">
              <div className="p-2 p-sm-3 bg-white rounded shadow-sm border-bottom border-success border-3 h-100 d-flex flex-column justify-content-center">
                <h6 className="text-muted mb-1" style={{fontSize: '0.75rem', textTransform: 'uppercase'}}>Lidas</h6>
                <h5 className="mb-0 fw-bold text-success">{qtdLidas}</h5>
              </div>
            </div>
            <div className="col-4">
              <div className="p-2 p-sm-3 bg-white rounded shadow-sm border-bottom border-danger border-3 h-100 d-flex flex-column justify-content-center">
                <h6 className="text-muted mb-1" style={{fontSize: '0.75rem', textTransform: 'uppercase'}}>Faltam</h6>
                <h5 className="mb-0 fw-bold text-danger">{qtdFaltam}</h5>
              </div>
            </div>
          </div>

          <div className="d-flex flex-column flex-sm-row justify-content-center gap-2 mb-4">
            <button onClick={gerarRelatorio} className="btn btn-outline-danger d-flex align-items-center justify-content-center gap-2 w-100 py-2 fw-semibold">
              <i className="bi bi-file-earmark-excel"></i> Exportar Relatório
            </button>
          </div>
          
          {relatorioNaTela.length > 0 && (
            <>
              <div className="card shadow-sm border-0 mb-4 animate__animated animate__fadeIn overflow-hidden">
                <div className="card-body p-0 table-responsive">
                  <table className="table table-hover mb-0 text-center align-middle" style={{whiteSpace: 'nowrap'}}>
                    <thead className="table-dark">
                      <tr>
                        <th className="py-3 px-3">Lote/Código</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-3" style={{width: '60px'}}>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relatorioNaTela.map((item, idx) => (
                        <tr key={idx} className={item.tipo === 'faltando' ? 'table-danger opacity-75' : ''}>
                          <td className="fw-bold py-3 px-3 text-start text-sm-center">{item.codigo}</td>
                          <td className="px-3">
                            {item.tipo === 'ok' && <span className="badge bg-success w-100 py-2">OK (Lida)</span>}
                            {item.tipo === 'faltando' && <span className="badge bg-danger w-100 py-2">Faltando</span>}
                            {item.tipo === 'sobrando' && <span className="badge bg-warning text-dark w-100 py-2">Sobra</span>}
                            {!item.tipo && <span className="badge bg-secondary w-100 py-2">{item.status}</span>}
                          </td>
                          <td className="px-3">
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
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="d-flex justify-content-center mb-5 mt-4">
                <button onClick={limparDados} className="btn fs-6 btn-link text-danger text-decoration-none d-flex align-items-center gap-2 p-2 w-100 justify-content-center">
                  <i className="bi bi-arrow-counterclockwise fs-5"></i> Iniciar Novo Inventário
                </button>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

export default App