import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TextHints } from './TextHints';

describe('TextHints', () => {
  it('shows nothing for plain English with no known words', () => { const { container } = render(<TextHints text="headache" language="en" onPickLanguage={() => {}} />); expect(container).toBeEmptyDOMElement(); });
  it('suggests the detected language and applies it only when the person presses the button', async () => {
    const pick = vi.fn(); render(<TextHints text="तीन दिन से बुखार" language="en" onPickLanguage={pick} />);
    expect(screen.getByRole('status')).toHaveTextContent('This looks like Hindi'); expect(pick).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Use Hindi' })); expect(pick).toHaveBeenCalledWith('hi');
  });
  it('lists everyday words found and says it is not a diagnosis', () => {
    render(<TextHints text="bukhar aur ulti" language="hi" />); expect(screen.getByText('fever')).toBeInTheDocument(); expect(screen.getByText('vomiting')).toBeInTheDocument(); expect(screen.getByText(/not a diagnosis/)).toBeInTheDocument();
  });
  it('without a picker it never offers a language change', () => { render(<TextHints text="तीन दिन से बुखार" language="en" />); expect(screen.queryByRole('button')).not.toBeInTheDocument(); });
});
