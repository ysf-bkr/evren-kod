import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_TASK_STATE } from '@shared/constants';
import { ReportsView } from '../src/components/views/reports';

afterEach(() => {
  cleanup();
});

describe('ReportsView: teknik borç ve izlenebilirlik panosu', () => {
  it('teknik borç sekmesini varsayılan olarak çizer ve sağlık puanını gösterir', () => {
    render(<ReportsView state={DEFAULT_TASK_STATE} onSelectMenu={() => {}} changedFileCount={0} />);

    assert.ok(screen.getByText('Raporlar & Analiz'));
    assert.ok(screen.getByText('Kod Tabanı Sağlık Puanı'));
    assert.ok(screen.getByText('95'));
    assert.ok(screen.getByText('Not: A'));
    assert.ok(screen.getByText('TODO (Yapılacak)'));
  });

  it('sekmeler arasında geçiş yapabilir', () => {
    render(<ReportsView state={DEFAULT_TASK_STATE} onSelectMenu={() => {}} changedFileCount={0} />);

    // İzlenebilirlik sekmesine tıkla
    fireEvent.click(screen.getByText('İzlenebilirlik'));
    assert.ok(screen.getByText(/Sıfır Kanıtsız Teslimat/));
    assert.ok(screen.getByText('REQ-SEC-01'));

    // Metrikler ve Maliyet sekmesine tıkla
    fireEvent.click(screen.getByText('Metrikler & Maliyet'));
    assert.ok(screen.getByText('Görev Başarı Oranı'));
    assert.ok(screen.getByText('%100'));
    assert.ok(screen.getByText('Tahmini Model Maliyeti'));

    // Ekip & Kilitler sekmesine tıkla
    fireEvent.click(screen.getByText('Ekip & Kilitler'));
    assert.ok(screen.getByText(/Aktif Dosya Kilitleri/));
    assert.ok(screen.getByText(/İnsan Varlık Koruması/));
  });
});
