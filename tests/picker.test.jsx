import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import App from '../src/App.jsx';

// Supabase is hier onbereikbaar (geen netwerk): de app hoort dan gewoon
// offline te werken op localStorage. Precies wat we willen testen.

describe('Picker: toevoegen via zoeken', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  async function openVoorbeeldlijst() {
    render(<App />);
    // inloggen
    fireEvent.change(screen.getByPlaceholderText('jij@voorbeeld.nl'), {
      target: { value: 'test@test.nl' },
    });
    fireEvent.click(screen.getByText('Verder →'));
    // wacht tot main met voorbeeldlijst er staat
    await waitFor(() => screen.getByText(/Zomervakantie/));
    fireEvent.click(screen.getByText(/Zomervakantie/));
    await waitFor(() => screen.getByText('+ Spullen toevoegen'));
    fireEvent.click(screen.getByText('+ Spullen toevoegen'));
    await waitFor(() => screen.getByPlaceholderText('Zoek of typ iets nieuws…'));
  }

  it('nieuw item via "In Bak + lijstje"', async () => {
    await openVoorbeeldlijst();
    fireEvent.change(screen.getByPlaceholderText('Zoek of typ iets nieuws…'), {
      target: { value: 'Drone' },
    });
    await waitFor(() => screen.getByText('📦 In Bak + lijstje'));
    fireEvent.click(screen.getByText('📦 In Bak + lijstje'));
    // item moet nu in de pickerlijst staan, aangevinkt ("in lijstje")
    await waitFor(() => {
      const row = screen.getAllByText('Drone').map((el) => el.closest('.pickrow')).find(Boolean);
      expect(row.textContent).toContain('in lijstje');
    });
  });

  it('nieuw item via "Alleen dit lijstje"', async () => {
    await openVoorbeeldlijst();
    fireEvent.change(screen.getByPlaceholderText('Zoek of typ iets nieuws…'), {
      target: { value: 'Cadeau oma' },
    });
    await waitFor(() => screen.getByText('✨ Alleen dit lijstje'));
    fireEvent.click(screen.getByText('✨ Alleen dit lijstje'));
    // sheet sluiten en in de lijst kijken
    fireEvent.click(screen.getByText(/^Klaar/));
    await waitFor(() => screen.getByText('Cadeau oma'));
    expect(screen.getByText('✨ Los in dit lijstje')).toBeTruthy();
  });

  it('typen + direct "toevoegen & klaar" voegt het item toe', async () => {
    await openVoorbeeldlijst();
    fireEvent.change(screen.getByPlaceholderText('Zoek of typ iets nieuws…'), {
      target: { value: 'Hangmat' },
    });
    fireEvent.click(await waitFor(() => screen.getByText(/toevoegen & klaar/)));
    // sheet is dicht, item staat in de lijst
    await waitFor(() => screen.getByText('Hangmat'));
  });

  it('Enter voegt direct toe aan Bak + lijstje', async () => {
    await openVoorbeeldlijst();
    const input = screen.getByPlaceholderText('Zoek of typ iets nieuws…');
    fireEvent.change(input, { target: { value: 'Verrekijker' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      const row = screen.getAllByText('Verrekijker').map((el) => el.closest('.pickrow')).find(Boolean);
      expect(row.textContent).toContain('in lijstje');
    });
  });

  it('bestaand bak-item via tikken op rij', async () => {
    await openVoorbeeldlijst();
    fireEvent.change(screen.getByPlaceholderText('Zoek of typ iets nieuws…'), {
      target: { value: 'Snorkelset' },
    });
    const row = (await waitFor(() => screen.getByText('Snorkelset'))).closest('.pickrow');
    fireEvent.click(row);
    await waitFor(() => expect(row.textContent).toContain('in lijstje'));
  });
});
