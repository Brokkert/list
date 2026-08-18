import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import App from '../src/App.jsx';

describe('Vertrek-modus', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it('behandelt elk item precies één keer, zonder overslaan', async () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Gebruikersnaam, bijv. laurens'), {
      target: { value: 'vertrektest' },
    });
    fireEvent.click(screen.getByText('Verder →'));
    await waitFor(() => screen.getByText(/Zomervakantie/), { timeout: 8000 });
    fireEvent.click(screen.getByText(/Zomervakantie/));
    fireEvent.click(await waitFor(() => screen.getByText(/Vertrek-modus/)));

    // De voorbeeldlijst heeft 15 items; de teller moet 1..15 aflopen en de
    // totaal-aanduiding mag onderweg niet krimpen (dat was de bug).
    const seen = [];
    for (let i = 1; i <= 15; i++) {
      await waitFor(() => screen.getByText(`${i} van 15`));
      seen.push(screen.getByText(`${i} van 15`).parentElement.querySelector('.vmodus-name').textContent);
      fireEvent.click(screen.getByText('✓ Ingepakt'));
    }
    await waitFor(() => screen.getByText('Vakantie ready!'));
    expect(new Set(seen).size).toBe(15); // allemaal uniek: niks dubbel, niks overgeslagen
  });

  it('geen "Vakantie ready" zolang er overgeslagen items zijn; rondje twee pakt ze op', async () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Gebruikersnaam, bijv. laurens'), {
      target: { value: 'vertrektest2' },
    });
    fireEvent.click(screen.getByText('Verder →'));
    await waitFor(() => screen.getByText(/Zomervakantie/), { timeout: 8000 });
    fireEvent.click(screen.getByText(/Zomervakantie/));
    fireEvent.click(await waitFor(() => screen.getByText(/Vertrek-modus/)));

    // Item 1 overslaan, de rest inpakken
    await waitFor(() => screen.getByText('1 van 15'));
    fireEvent.click(screen.getByText('→ Sla over'));
    for (let i = 2; i <= 15; i++) {
      await waitFor(() => screen.getByText(`${i} van 15`));
      fireEvent.click(screen.getByText('✓ Ingepakt'));
    }

    // Geen feest, maar een tussenstand met een tweede rondje
    await waitFor(() => screen.getByText('Nog 1 item over'));
    expect(screen.queryByText('Vakantie ready!')).toBeNull();
    fireEvent.click(screen.getByText(/Nog een rondje/));

    await waitFor(() => screen.getByText('1 van 1'));
    fireEvent.click(screen.getByText('✓ Ingepakt'));
    await waitFor(() => screen.getByText('Vakantie ready!'));
  });
});
