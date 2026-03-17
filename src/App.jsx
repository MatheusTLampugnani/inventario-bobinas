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

  // LÓGICA DE SESSÃO DO BANCO
  const garantirSessao = async () => {
    if (sessaoId) return sessaoId;

    const { data, error } = await supabase
      .from('sessoes_inventario')
      .insert([{ cracha_importacao: crachaLogado, status: 'Não importado CSV' }])
      .select('id')
      .single();

    if (error) {
      console.error("Erro ao criar sessão:", error);
      throw error;
    }

    setSessaoId(data.id);
    return data.id;
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
        const separator = text.includes(';') ? ';' : ',';
        const linhas = text.split('\n').filter(linha => linha.trim() !== '');
        
        if (linhas.length === 0) {
          setCarregandoAcao(false);
          return;
        }

        const headers = linhas[0].split(separator).map(h => h.trim().toLowerCase());
        const idxLote = headers.indexOf('lote');
        const idxMaterial = headers.indexOf('material');
        const idxOrdem = headers.indexOf('ordem produção') !== -1 ? headers.indexOf('ordem produção') : headers.indexOf('ordem_producao');
        const idxCliente = headers.indexOf('cliente');
        const idxNomeCliente = headers.indexOf('nome');

        if (idxLote === -1) {
          abrirAlerta('Erro', 'A coluna "Lote" é obrigatória e não foi encontrada no arquivo.');
          setCarregandoAcao(false);
          return;
        }

        let codigosExtraidos = [];
        for (let i = 1; i < linhas.length; i++) {
          const colunas = linhas[i].split(separator);
          if (colunas.length > idxLote) {
            const lote = colunas[idxLote]?.trim().replace(/^"|"$/g, '');
            if (lote && lote !== '') {
              codigosExtraidos.push({
                lote: lote,
                material: idxMaterial !== -1 ? colunas[idxMaterial]?.trim().replace(/^"|"$/g, '') : '',
                ordem_producao: idxOrdem !== -1 ? colunas[idxOrdem]?.trim().replace(/^"|"$/g, '') : '',
                cliente: idxCliente !== -1 ? colunas[idxCliente]?.trim().replace(/^"|"$/g, '') : '',
                nome_cliente: idxNomeCliente !== -1 ? colunas[idxNomeCliente]?.trim().replace(/^"|"$/g, '') : ''
              });
            }
          }
        }

        const idSessaoAtiva = await garantirSessao();

        const dadosParaBanco = codigosExtraidos.map(item => ({
          sessao_id: idSessaoAtiva,
          lote: item.lote,
          material: item.material,
          ordem_producao: item.ordem_producao,
          cliente: item.cliente,
          nome_cliente: item.nome_cliente
        }));

        const { error } = await supabase.from('bobinas_sap').insert(dadosParaBanco);

        if (error) throw error;

        setCsvBobinas(codigosExtraidos);
        abrirAlerta('Sucesso', `${codigosExtraidos.length} bobinas esperadas importadas e salvas no banco!`);

      } catch (erro) {
        console.error(erro);
        abrirAlerta('Erro', 'Ocorreu um erro ao salvar a planilha no banco de dados.');
      } finally {
        if(fileInputRef.current) fileInputRef.current.value = ''; 
        setCarregandoAcao(false);
      }
    };
    reader.readAsText(file);
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
    
    let csvContent = "data:text/csv;charset=utf-8,Lote;Material;Ordem Producao;Cliente;Nome Cliente;Status;Data e Hora Leitura;Operador;Cracha\n" 
      + dados.map(e => `${e.codigo};${e.material};${e.ordem_producao};${e.cliente};${e.nome_cliente};${e.status};${e.dataHora};${e.nome_operador};${e.cracha}`).join("\n");
      
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


  // TELA DE LOGIN
  if (!crachaLogado) {
    return (
      <div className="min-vh-100 bg-light d-flex justify-content-center align-items-center position-relative px-3">
        {modal.show && (
          <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content shadow border-0">
                <div className="modal-header border-0 bg-dark text-white">
                  <h5 className="modal-title fw-bold">Aviso</h5>
                  <button type="button" className="btn-close btn-close-white" onClick={fecharModal}></button>
                </div>
                <div className="modal-body p-4 fs-5 text-secondary text-center">
                  <p className="mb-0">{modal.message}</p>
                </div>
                <div className="modal-footer border-0 justify-content-center pb-4">
                  <button type="button" className="btn btn-secondary px-4" onClick={fecharModal}>Fechar</button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="card shadow-lg border-0 p-4 p-md-5" style={{ maxWidth: '450px', width: '100%', borderRadius: '12px' }}>
          <div className="text-center mb-5">
            <img src={logoVideplast} alt="Videplast" className="img-fluid mb-4" style={{maxHeight: '70px'}} />
            <h4 className="fw-bold text-dark">Inventário de Bobinas</h4>
            <p className="text-muted">Identifique-se para iniciar a contagem</p>
          </div>
          
          <div className="mb-4">
            <label className="form-label text-secondary fw-semibold">Número do seu Crachá</label>
            <input 
              type="text" 
              className="form-control form-control-lg bg-light" 
              placeholder="Ex: 12345"
              value={inputCracha} 
              onChange={e => setInputCracha(e.target.value)} 
              onKeyDown={e => e.key === 'Enter' && !carregandoLogin && fazerLogin()} 
              autoFocus 
              disabled={carregandoLogin}
            />
          </div>
          
          <button 
            className="btn btn-primary btn-lg w-100 fw-bold shadow-sm" 
            onClick={fazerLogin} 
            disabled={carregandoLogin}
            style={{backgroundColor: '#d80404', border: 'none'}}
          >
            {carregandoLogin ? (
              <><span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span> Validando...</>
            ) : 'Entrar no Sistema'}
          </button>
        </div>
      </div>
    );
  }

  // TELA PRINCIPAL
  return (
    <div className="min-vh-100 bg-light d-flex flex-column justify-content-top align-items-top position-relative">
      {modal.show && (
        <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content shadow border-0" style={{borderRadius: '4px'}}>
              <div className={`modal-header border-0 ${modal.type === 'confirm' ? 'bg-danger text-white' : 'bg-dark text-white'}`} style={{borderRadius: '4px 4px 0 0'}}>
                <h5 className="modal-title fw-bold">
                  {modal.type === 'confirm' && <i className="bi bi-exclamation-triangle-fill me-2"></i>}
                  {modal.title}
                </h5>
                <button type="button" className="btn-close btn-close-white" onClick={fecharModal}></button>
              </div>
              <div className="modal-body p-4 fs-5 text-secondary text-center">
                <p className="mb-0">{modal.message}</p>
              </div>
              <div className="modal-footer border-0 justify-content-center pb-4">
                <button type="button" className="btn btn-secondary px-4" onClick={fecharModal}>
                  {modal.type === 'confirm' ? 'Cancelar' : 'Fechar'}
                </button>
                {modal.type === 'confirm' && (
                  <button type="button" className="btn btn-danger px-4" onClick={modal.onConfirm}>Sim</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="container" style={{ maxWidth: '800px' }}>
        <Header />

        {/* HEADER PARA INFORMAR OPERADOR LOGADO */}
        <div className="d-flex justify-content-between align-items-center bg-white p-3 rounded shadow-sm border border-secondary border-opacity-10 mb-4">
          <div>
            <span className="text-muted small d-block">Operador Logado</span>
            <span className="fw-bold text-dark">{nomeLogado} <span className="text-secondary fw-normal">- {crachaLogado}</span></span>
          </div>
          <button className="btn btn-outline-danger btn-sm" onClick={fazerLogout}>
            Sair
          </button>
        </div>

        {/* CAMPO DE IMPORTAÇAO DE DADOS DO SAP */}
        <main>
          <div className="card shadow-sm border-0 mb-4 bg-light border border-secondary border-opacity-25">
            <div className="card-body p-3 d-flex justify-content-between align-items-center flex-wrap gap-2">
              <div>
                <h6 className="mb-1 fw-bold text-secondary">Base do SAP (CSV)</h6>
                <small className="text-muted">Importe o arquivo do SAP.</small>
              </div>
              <div>
                <input type="file" accept=".csv" className="d-none" ref={fileInputRef} onChange={importarCSV} id="csvUpload" disabled={carregandoAcao} />
                <label htmlFor="csvUpload" className={`btn btn-outline-secondary btn-sm m-0 ${carregandoAcao ? 'disabled' : ''}`}>
                  {carregandoAcao ? 'Salvando...' : '📁 Importar SAP'}
                </label>
              </div>
            </div>
          </div>

          {/* FUNÇAO PARA USAR CAMERA DO TELEFONE */}
          {usandoCamera ? (
            <Scanner 
              aoLerCodigo={adicionarBobina} 
              aoCancelar={() => setUsandoCamera(false)} 
            />
          ) : (
            <div className="card shadow-sm border-0 mb-4">
              <div className="card-body p-4 text-center">
                <label htmlFor="inputBobina" className="form-label text-muted mb-3">
                  Leitura de Bobina
                </label>
                
                <div className="input-group input-group-lg shadow-sm mb-3">
                  <input
                    id="inputBobina"
                    ref={inputRef}
                    type="text"
                    className="form-control border-end-0"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !carregandoAcao && adicionarBobina()}
                    placeholder="Digite ou bipe o código..."
                    autoComplete="off"
                    disabled={carregandoAcao}
                  />
                  <button 
                    className="btn btn-primary px-4" 
                    style={{backgroundColor: '#d80404', border: 'none'}} 
                    onClick={() => adicionarBobina()}
                    disabled={carregandoAcao}
                  >
                    Adicionar
                  </button>
                </div>
                
                <button 
                  className="btn btn-secondary d-flex align-items-center justify-content-center gap-2 mx-auto w-100"
                  onClick={() => setUsandoCamera(true)}
                  style={{maxWidth: '300px'}}
                  disabled={carregandoAcao}
                >
                  <i className="bi bi-camera"></i> Ler com a Câmera
                </button>
              </div>
            </div>
          )}

          {/* GERAÇAO DE RELATORIO */}
          <div className="d-flex justify-content-center gap-3 mb-4">
            <button onClick={gerarRelatorio} className="btn btn-outline-danger d-flex align-items-center gap-2">
              📄 Exportar Relatório (Backup)
            </button>
          </div>

          {/* STATUS DE CODIGOS IMPORTADOS */}
          <div className="row g-3 mb-4 text-center">
            <div className="col-4">
              <div className="p-3 bg-white rounded shadow-sm border-bottom border-secondary border-3">
                <h6 className="text-muted mb-1">Esperadas</h6>
                <h4 className="mb-0 fw-bold">{qtdEsperadas}</h4>
              </div>
            </div>
            <div className="col-4">
              <div className="p-3 bg-white rounded shadow-sm border-bottom border-success border-3">
                <h6 className="text-muted mb-1">Lidas</h6>
                <h4 className="mb-0 fw-bold">{qtdLidas}</h4>
              </div>
            </div>
            <div className="col-4">
              <div className="p-3 bg-white rounded shadow-sm border-bottom border-danger border-3">
                <h6 className="text-muted mb-1">Faltam</h6>
                <h4 className="mb-0 fw-bold text-danger">{qtdFaltam}</h4>
              </div>
            </div>
          </div>
          
          {/* TABELA DE CODIGOS INVENTARIO */}
          {relatorioNaTela.length > 0 && (
            <>
              <div className="card shadow-sm border-0 mb-4 animate__animated animate__fadeIn">
                <div className="card-body p-0">
                  <table className="table table-hover mb-0 text-center align-middle">
                    <thead className="table-dark">
                      <tr>
                        <th className="py-3">Lote/Código</th>
                        <th className="py-3">Status</th>
                        <th className="py-3" style={{width: '60px'}}>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relatorioNaTela.map((item, idx) => (
                        <tr key={idx} className={item.tipo === 'faltando' ? 'table-danger opacity-75' : ''}>
                          <td className="fw-bold py-3">{item.codigo}</td>
                          <td>
                            {item.tipo === 'ok' && <span className="badge bg-success">{item.status}</span>}
                            {item.tipo === 'faltando' && <span className="badge bg-danger">{item.status}</span>}
                            {item.tipo === 'sobrando' && <span className="badge bg-warning text-dark">{item.status}</span>}
                            {!item.tipo && <span className="badge bg-secondary">{item.status}</span>}
                          </td>
                          <td>
                            {item.tipo !== 'faltando' && (
                              <button 
                                className="btn btn-sm btn-outline-danger border-0" 
                                onClick={() => removerBobina(item.codigo)}
                                title="Excluir leitura"
                                disabled={carregandoAcao}
                              >
                                <i className="bi bi-trash"></i>
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="d-flex justify-content-center mb-5">
                <button onClick={limparDados} className="btn fs-6 btn-link text-danger text-decoration-none d-flex align-items-center gap-2">
                  <i className="bi bi-x-circle"></i> Iniciar Novo Inventário / Limpar Tela
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