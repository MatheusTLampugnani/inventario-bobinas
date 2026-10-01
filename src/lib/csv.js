// src/lib/csv.js — Exportação CSV compatível com o Excel brasileiro (";" + BOM UTF-8).

/** Formata um valor para uma célula CSV. Vazio vira '-' (padrão dos relatórios). */
export const campoCSV = (val) => {
  if (val === undefined || val === null || val === '' || val === '-') return '-';
  let s = String(val);
  // Evita que o Excel interprete o conteúdo como fórmula
  if (/^[=+@\t\r]/.test(s)) s = `'${s}`;
  if (/[;,"\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
};

/** Gera o arquivo e dispara o download. Usa Blob (data: URI corta o conteúdo em '#'). */
export function baixarCSV(nomeArquivo, cabecalho, linhas) {
  const blob = new Blob(['﻿' + cabecalho + '\n' + linhas.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revogar na hora pode cancelar o download em alguns navegadores (Safari/iOS)
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
