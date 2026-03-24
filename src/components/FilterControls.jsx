import React from 'react';
import { Row, Col, Form, Button, InputGroup } from 'react-bootstrap';
import { SortDown, SortUp, X } from 'react-bootstrap-icons';

const FilterControls = ({
  filters,
  onFilterChange,
  onResetFilters,
  sortConfig,
  onSortChange,
  itemsCount,
}) => {
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    onFilterChange({ ...filters, [name]: value });
  };

  const handleSortFieldChange = (e) => {
    onSortChange({ ...sortConfig, field: e.target.value });
  };

  const toggleSortOrder = () => {
    onSortChange({ ...sortConfig, order: sortConfig.order === 'asc' ? 'desc' : 'asc' });
  };

  return (
    <div className="my-4 p-3 border rounded bg-light shadow-sm text-start">
      <Row className="g-3 align-items-end">
        <Col xl={2} lg={3} md={4} xs={12}>
          <Form.Group>
            <Form.Label className="small fw-bold text-muted mb-1">Lote</Form.Label>
            <Form.Control
              type="text"
              name="lote"
              value={filters.lote || ''}
              onChange={handleInputChange}
              placeholder="Filtrar por lote..."
            />
          </Form.Group>
        </Col>

        <Col xl={2} lg={3} md={4} xs={6}>
          <Form.Group>
            <Form.Label className="small fw-bold text-muted mb-1">Data de Leitura</Form.Label>
            <Form.Control
              type="text"
              name="data_leitura"
              value={filters.data_leitura || ''}
              onChange={handleInputChange}
              placeholder="Filtrar..."
            />
          </Form.Group>
        </Col>

        <Col xl={4} lg={4} md={6} xs={12}>
          <Form.Group>
            <Form.Label className="small fw-bold text-muted mb-1">Ordenar por</Form.Label>
            <InputGroup>
              <Form.Select
                name="sortField"
                value={sortConfig.field}
                onChange={handleSortFieldChange}
              >
                <option value="Data">Data leitura</option>
                <option value="Lote">Lote</option>
              </Form.Select>
              <Button variant="outline-secondary" onClick={toggleSortOrder}>
                {sortConfig.order === 'asc' ? <SortUp /> : <SortDown />}
              </Button>
            </InputGroup>
          </Form.Group>
        </Col>

        <Col xl="auto" lg={2} md={2} xs={12} className="d-flex align-items-end mt-3 mt-md-0 ms-auto">
          <Button variant="outline-danger" onClick={onResetFilters} className="w-100 d-flex align-items-center justify-content-center gap-1">
            <X size={20} /> Limpar
          </Button>
        </Col>
      </Row>

      <div className="text-end mt-3 text-muted small">
        <strong>{itemsCount}</strong> {itemsCount === 1 ? 'item encontrado' : 'itens encontrados'}
      </div>
    </div>
  );
};

export default FilterControls;