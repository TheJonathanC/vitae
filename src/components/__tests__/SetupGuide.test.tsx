import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SetupGuide from "../SetupGuide";

vi.mock("@tauri-apps/api/shell", () => ({
  open: vi.fn(),
}));

describe("SetupGuide component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the first step and navigates forward/backward", () => {
    const handleClose = vi.fn();
    render(<SetupGuide onClose={handleClose} />);

    // Step 1
    expect(screen.getByText("Welcome to Vitae!")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();

    // Click Next -> Step 2
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Install LaTeX Distribution")).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();

    // Click Back -> Step 1
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByText("Welcome to Vitae!")).toBeInTheDocument();
  });

  it("completes the guide and calls onClose on last step", () => {
    const handleClose = vi.fn();
    render(<SetupGuide onClose={handleClose} />);

    // Advance to step 2
    fireEvent.click(screen.getByText("Next"));
    // Advance to step 3
    fireEvent.click(screen.getByText("Next"));

    expect(screen.getByText("You're All Set!")).toBeInTheDocument();
    expect(screen.getByText("Step 3 of 3")).toBeInTheDocument();

    // Click Got It!
    fireEvent.click(screen.getByText("Got It!"));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
