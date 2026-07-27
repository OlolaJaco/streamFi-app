import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SettingsPage from '../page';

describe('SettingsPage', () => {
  it('renders the heading', () => {
    render(<SettingsPage />);
    expect(screen.getByText('Settings')).toBeDefined();
  });

  it('renders appearance, preferences, and general sections', () => {
    render(<SettingsPage />);
    expect(screen.getByText('Appearance')).toBeDefined();
    expect(screen.getByText('Preferences')).toBeDefined();
    expect(screen.getByText('General')).toBeDefined();
  });

  it('renders theme buttons', () => {
    render(<SettingsPage />);
    expect(screen.getByText('Light')).toBeDefined();
    expect(screen.getByText('Dark')).toBeDefined();
    expect(screen.getByText('System')).toBeDefined();
  });

  it('renders currency select', () => {
    render(<SettingsPage />);
    expect(screen.getByText('Display Currency')).toBeDefined();
  });

  it('renders slippage tolerance buttons', () => {
    render(<SettingsPage />);
    expect(screen.getByText('0.5%')).toBeDefined();
    expect(screen.getByText('1.0%')).toBeDefined();
    expect(screen.getByText('2.0%')).toBeDefined();
    expect(screen.getByText('5.0%')).toBeDefined();
  });

  it('renders notification toggle', () => {
    render(<SettingsPage />);
    expect(screen.getByText('Enable Notifications')).toBeDefined();
  });

  it('renders advanced mode toggle', () => {
    render(<SettingsPage />);
    expect(screen.getByText('Advanced Mode')).toBeDefined();
  });

  it('renders reset button', () => {
    render(<SettingsPage />);
    expect(screen.getByText('Reset to Defaults')).toBeDefined();
  });
});
