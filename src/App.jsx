import { useState, useRef, useEffect } from 'react'
import Header from './components/Header'
import './App.css'

function App() {
  const [codigo, setCodigo] = useState('')
  const [inventario, setInventario] = useState([])
  const inputRef = useRef(null)

  useEffect(() => {
    if(inputRef.current) inputRef.current.focus();
  }, []);

  const adicionarItem = () => {
    if (!codigo.trim()) return;
    const existe = inventario.some(item => item.patrimonio === codigo);
    if (existe) {
      alert(`O património ${codigo} já foi registado.`);
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

  const gerarRelatorio = () => {
    if (inventario.length === 0) {
      alert("Sem dados para gerar relatório."); return;
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
    <div className="min-vh-100 bg-light d-flex flex-column justify-content-top align-items-center py-5">
      
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
            <div className="card shadow-sm border-0 animate__animated animate__fadeIn">
              <div className="card-body p-0">
                <table className="table table-striped table-hover mb-0 text-center">
                  <thead className="table-dark">
                    <tr>
                      <th scope="col" className="py-3">Código do Ativo</th>
                      <th scope="col" className="py-3">Horário da Leitura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventario.map((item, index) => (
                      <tr key={index}>
                        <td className="fw-bold text-danger py-3">{item.patrimonio}</td>
                        <td className="py-3">{item.dataHora}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App