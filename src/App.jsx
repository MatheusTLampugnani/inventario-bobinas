import { useState, useRef, useEffect } from 'react'
import Header from './components/Header'
import './App.css'

function App() {
  const [codigo, setCodigo] = useState('')
  
  const [inventario, setInventario] = useState(() => {
    const saved = sessionStorage.getItem('inventario_videplast');
    return saved ? JSON.parse(saved) : [];
  })
  
  const [modal, setModal] = useState({
    show: false,
    title: '',
    message: '',
    type: 'alert',
    onConfirm: null
  })

  const inputRef = useRef(null)

  useEffect(() => {
    sessionStorage.setItem('inventario_videplast', JSON.stringify(inventario));
  }, [inventario]);

  useEffect(() => {
    if(inputRef.current && !modal.show) {
      inputRef.current.focus();
    }
  }, [modal.show]);

  const fecharModal = () => {
    setModal({ ...modal, show: false });
  }

  const abrirAlerta = (titulo, mensagem) => {
    setModal({
      show: true,
      title: titulo,
      message: mensagem,
      type: 'alert',
      onConfirm: null
    });
  }

  const abrirConfirmacao = (titulo, mensagem, acaoConfirmar) => {
    setModal({
      show: true,
      title: titulo,
      message: mensagem,
      type: 'confirm',
      onConfirm: () => {
        acaoConfirmar();
        fecharModal();
      }
    });
  }

  const adicionarItem = () => {
    if (!codigo.trim()) return;
    
    const existe = inventario.some(item => item.patrimonio === codigo);
    
    if (existe) {
      abrirAlerta('Item Duplicado', `O património ${codigo} já foi registado.`);
      setCodigo('');
      return;
    }

    const novoItem = { patrimonio: codigo, dataHora: new Date().toLocaleString('pt-PT') };
    setInventario([novoItem, ...inventario]);
    setCodigo('');
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') adicionarItem();
  }

  const removerItem = (indexParaRemover) => {
    const novaLista = inventario.filter((_, index) => index !== indexParaRemover);
    setInventario(novaLista);
  }

  const limparLista = () => {
    abrirConfirmacao(
      'Limpar Inventário',
      'Tem certeza que deseja limpar TODA a lista de inventário?',
      () => setInventario([])
    );
  }

  const gerarRelatorio = () => {
    if (inventario.length === 0) {
      abrirAlerta('Lista Vazia', 'Sem dados para gerar relatório.'); 
      return;
    }
    
    let csvContent = "data:text/csv;charset=utf-8,Patrimonio;Data e Hora\n" 
      + inventario.map(e => `${e.patrimonio};${e.dataHora}`).join("\n");
      
    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.download = `inventario_${new Date().getTime()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="min-vh-100 bg-light d-flex flex-column justify-content-top align-items-top position-relative">
      
      {modal.show && (
        <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content shadow border-0" style={{borderRadius: '4px'}}>
              <div className={`modal-header border-0 ${modal.type === 'confirm' ? 'bg-danger text-white' : 'bg-white text-dark'}`} style={{borderRadius: '4px 4px 0 0'}}>
                <h5 className="modal-title fw-bold">
                  {modal.type === 'confirm' && <i className="bi bi-exclamation-triangle-fill me-2"></i>}
                  {modal.title}
                </h5>
                <button type="button" className={`btn-close ${modal.type === 'confirm' ? 'btn-close-white' : ''}`} onClick={fecharModal} aria-label="Close"></button>
              </div>
              
              <div className="modal-body p-4 fs-5 text-secondary text-center">
                <p className="mb-0">{modal.message}</p>
              </div>

              <div className="modal-footer border-0 justify-content-center pb-4">
                <button type="button" className="btn btn-secondary px-4" onClick={fecharModal}>
                  {modal.type === 'confirm' ? 'Cancelar' : 'Fechar'}
                </button>
                
                {modal.type === 'confirm' && (
                  <button type="button" className="btn btn-danger px-4" onClick={modal.onConfirm}>
                    Sim, Limpar
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="container" style={{ maxWidth: '800px' }}>
        <Header />

        <main>
          <div className="card shadow-sm border-0 mb-4">
            <div className="card-body p-4 text-center">
              <label htmlFor="inputCodigo" className="form-label text-muted mb-3">
                Leitura de Código de Barras / Digitação
              </label>
              
              <div className="input-group input-group-lg shadow-sm">
                <input
                  id="inputCodigo"
                  ref={inputRef}
                  type="text"
                  className="form-control border-end-0"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Digite o código do ativo..."
                  autoComplete="off"
                />
                <button 
                  className="btn btn-videplast px-4" 
                  onClick={adicionarItem}
                >
                  Adicionar
                </button>
              </div>
              <div className="form-text mt-2">
                Pressione <strong>Enter</strong> após digitar o código.
              </div>
            </div>
          </div>

          <div className="d-flex justify-content-center align-items-center gap-3 mb-4 flex-wrap">
            <button 
              onClick={gerarRelatorio} 
              className="btn btn-outline-videplast d-flex align-items-center gap-2"
            >
              📄 Gerar Relatórios (CSV)
            </button>
            <span className="badge bg-secondary p-2 fs-6 rounded-1">
              Itens lidos: {inventario.length}
            </span>
          </div>

          {inventario.length > 0 && (
            <>
              <div className="card shadow-sm border-0 animate__animated animate__fadeIn">
                <div className="card-body p-0">
                  <table className="table table-striped table-hover mb-0 text-center align-middle">
                    <thead className="table-dark">
                      <tr>
                        <th scope="col" className="py-3">Código do Ativo</th>
                        <th scope="col" className="py-3">Horário da Leitura</th>
                        <th scope="col" className="py-3" style={{width: '60px'}}>Ação</th> 
                      </tr>
                    </thead>
                    <tbody>
                      {inventario.map((item, index) => (
                        <tr key={index}>
                          <td className="fw-bold text-danger py-3">{item.patrimonio}</td>
                          <td className="py-3">{item.dataHora}</td>
                          <td>
                            <button 
                              className="btn btn-sm btn-outline-danger border-0" 
                              onClick={() => removerItem(index)}
                              title="Excluir item"
                            >
                              <i className="bi bi-trash"></i>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="d-flex justify-content-center mt-3">
                <button 
                  onClick={limparLista} 
                  className="btn fs-6 btn-link text-secondary text-decoration-none d-flex align-items-center gap-2"
                >
                  <i className="bi bi-x-circle"></i> Limpar lista completa
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