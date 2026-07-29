import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilePicker } from "./FilePicker";

function makeFile(name: string, type = "") {
  return new File(["file"], name, { type });
}

describe("FilePicker", () => {
  it("presents itself as a pdf compression tool without visible reader copy", () => {
    const { container } = render(<FilePicker onFileSelected={() => {}} />);

    expect(screen.getByRole("heading", { name: "PDF Compress" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select file" })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/epub|reader|book/i);
  });

  it("limits the native picker to supported local file types", () => {
    const { container } = render(<FilePicker onFileSelected={() => {}} />);
    const input = container.querySelector('input[type="file"]');

    expect(input).toHaveAttribute("accept", expect.stringContaining(".pdf"));
    expect(input).toHaveAttribute("accept", expect.stringContaining(".epub"));
  });

  it("passes pdf files to the pdf handler instead of opening the reader", () => {
    const onFileSelected = vi.fn();
    const onPdfSelected = vi.fn();
    const { container } = render(
      <FilePicker onFileSelected={onFileSelected} onPdfSelected={onPdfSelected} />
    );

    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [makeFile("report.pdf", "application/pdf")] }
    });

    expect(onPdfSelected).toHaveBeenCalledWith(expect.objectContaining({ name: "report.pdf" }));
    expect(onFileSelected).not.toHaveBeenCalled();
  });
});
