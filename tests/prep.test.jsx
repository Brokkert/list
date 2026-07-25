import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import App from '../src/App.jsx';

// Supabase is onbereikbaar in de testomgeving; de app werkt dan offline
// op localStorage — precies goed voor deze flows.

describe('Vooraf-actie (prep) toggle-flow', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  async function openVoorbeeldlijst() {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('jij@voorbeeld.nl'), {
      target: { value: 'prep@test.nl' },
    });
    fireEvent.click(screen.getByText('Verder →'));
    await waitFor(() => screen.getByText(/Zomervakantie/));
    fireEvent.click(screen.getByText(/Zomervakantie/));
    await waitFor(() => screen.getByText('+ Spullen toevoegen'));
  }

  it('prep instellen via sheet, badge togglet gedaan/terug in beide modi', async () => {
    await openVoorbeeldlijst();

    // Bewerk-modus aan en de item-sheet van het eerste item openen
    fireEvent.click(screen.getByText('✏️ bewerk'));
    const pencils = await waitFor(() => screen.getAllByTitle('Bewerken (vooraf, notitie, weghalen)'));
    fireEvent.click(pencils[0]);

    // Kopen-chip aanzetten en opslaan
    fireEvent.click(await waitFor(() => screen.getByText('🛒 Kopen')));
    fireEvent.click(screen.getByText('Opslaan'));

    // Badge zichtbaar in bewerk-modus, open (oranje) variant
    let badge = await waitFor(() => screen.getByText(/🛒 Kopen/, { selector: '.prepbadge' }));
    expect(badge.className).toContain('open');

    // Tik: wordt gedaan (groen ✓)
    fireEvent.click(badge);
    badge = await waitFor(() => screen.getByText(/✓ Kopen/, { selector: '.prepbadge' }));
    expect(badge.className).toContain('done');

    // Bewerk-modus uit: badge blijft zichtbaar en togglet terug naar open
    fireEvent.click(screen.getByText('✓ klaar'));
    badge = await waitFor(() => screen.getByText(/✓ Kopen/, { selector: '.prepbadge' }));
    fireEvent.click(badge);
    badge = await waitFor(() => screen.getByText(/🛒 Kopen/, { selector: '.prepbadge' }));
    expect(badge.className).toContain('open');
  });

  it('sheet opnieuw opslaan met zelfde chip behoudt gedaan-status', async () => {
    await openVoorbeeldlijst();

    fireEvent.click(screen.getByText('✏️ bewerk'));
    const pencils = await waitFor(() => screen.getAllByTitle('Bewerken (vooraf, notitie, weghalen)'));
    fireEvent.click(pencils[0]);
    fireEvent.click(await waitFor(() => screen.getByText('🛒 Kopen')));
    fireEvent.click(screen.getByText('Opslaan'));

    // Markeer gedaan
    let badge = await waitFor(() => screen.getByText(/🛒 Kopen/, { selector: '.prepbadge' }));
    fireEvent.click(badge);
    await waitFor(() => screen.getByText(/✓ Kopen/, { selector: '.prepbadge' }));

    // Sheet opnieuw openen en opslaan zonder wijziging → nog steeds gedaan
    const pencils2 = screen.getAllByTitle('Bewerken (vooraf, notitie, weghalen)');
    fireEvent.click(pencils2[0]);
    fireEvent.click(await waitFor(() => screen.getByText('Opslaan')));
    await waitFor(() => screen.getByText(/✓ Kopen/, { selector: '.prepbadge' }));
  });
});
