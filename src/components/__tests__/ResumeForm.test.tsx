import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ResumeForm from "../ResumeForm";
import { getDefaultResumeData } from "../../utils/templateEngine";
import { ResumeData } from "../../types";

describe("ResumeForm component", () => {
  const initialData: ResumeData = getDefaultResumeData("Taylor Swift");

  it("renders personal info fields with populated data", () => {
    const onChange = vi.fn();
    render(<ResumeForm data={initialData} onChange={onChange} />);

    expect(screen.getByTestId("resume-form")).toBeInTheDocument();
    const nameInput = screen.getByTestId("input-personal-name") as HTMLInputElement;
    expect(nameInput.value).toBe("Taylor Swift");
  });

  it("updates personal info when user edits name input", () => {
    const onChange = vi.fn();
    render(<ResumeForm data={initialData} onChange={onChange} />);

    const nameInput = screen.getByTestId("input-personal-name");
    fireEvent.change(nameInput, { target: { value: "Taylor Alison Swift" } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        personal: expect.objectContaining({
          name: "Taylor Alison Swift",
        }),
      })
    );
  });

  it("allows adding a new experience entry", () => {
    const onChange = vi.fn();
    render(<ResumeForm data={initialData} onChange={onChange} />);

    const addExpBtn = screen.getByTestId("btn-add-experience");
    fireEvent.click(addExpBtn);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        experience: expect.arrayContaining([
          ...initialData.experience,
          expect.objectContaining({
            company: "",
            role: "",
          }),
        ]),
      })
    );
  });

  it("allows adding a new education entry", () => {
    const onChange = vi.fn();
    render(<ResumeForm data={initialData} onChange={onChange} />);

    const addEduBtn = screen.getByTestId("btn-add-education");
    fireEvent.click(addEduBtn);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        education: expect.arrayContaining([
          ...initialData.education,
          expect.objectContaining({
            institution: "",
            degree: "",
          }),
        ]),
      })
    );
  });

  it("allows adding a new project entry", () => {
    const onChange = vi.fn();
    render(<ResumeForm data={initialData} onChange={onChange} />);

    const addProjBtn = screen.getByTestId("btn-add-project");
    fireEvent.click(addProjBtn);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        projects: expect.arrayContaining([
          ...initialData.projects,
          expect.objectContaining({
            name: "",
          }),
        ]),
      })
    );
  });

  it("renders custom variables if provided", () => {
    const onChange = vi.fn();
    render(
      <ResumeForm
        data={initialData}
        onChange={onChange}
        customFields={[
          { key: "security_clearance", label: "Security Clearance", type: "text" },
        ]}
      />
    );

    expect(screen.getByText("Security Clearance")).toBeInTheDocument();
  });

  it("renders section navigation tabs with count badges and allows switching sections", () => {
    const onChange = vi.fn();
    render(<ResumeForm data={initialData} onChange={onChange} />);

    // Verify all section tabs are present
    expect(screen.getByTestId("section-tab-all")).toBeInTheDocument();
    expect(screen.getByTestId("section-tab-personal")).toBeInTheDocument();
    expect(screen.getByTestId("section-tab-experience")).toBeInTheDocument();
    expect(screen.getByTestId("section-tab-education")).toBeInTheDocument();
    expect(screen.getByTestId("section-tab-projects")).toBeInTheDocument();
    expect(screen.getByTestId("section-tab-skills")).toBeInTheDocument();

    // Default tab should be 'all'
    expect(screen.getByTestId("section-tab-all")).toHaveClass("active");
    expect(screen.getByTestId("section-card-personal")).toBeInTheDocument();
    expect(screen.getByTestId("section-card-experience")).toBeInTheDocument();

    // Switch to experience tab
    fireEvent.click(screen.getByTestId("section-tab-experience"));
    expect(screen.getByTestId("section-tab-experience")).toHaveClass("active");
    expect(screen.getByTestId("section-tab-all")).not.toHaveClass("active");

    // Only Experience section should be visible
    expect(screen.getByTestId("section-card-experience")).toBeInTheDocument();
    expect(screen.queryByTestId("section-card-personal")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-card-education")).not.toBeInTheDocument();
  });

  it("supports sequential traversal via Previous and Next buttons", () => {
    const onChange = vi.fn();
    render(<ResumeForm data={initialData} onChange={onChange} />);

    // Switch to Personal section
    fireEvent.click(screen.getByTestId("section-tab-personal"));
    expect(screen.getByTestId("section-card-personal")).toBeInTheDocument();
    expect(screen.queryByTestId("section-card-experience")).not.toBeInTheDocument();

    // Click Next to go to Experience
    const nextBtn = screen.getByTestId("btn-nav-next-personal");
    fireEvent.click(nextBtn);

    expect(screen.getByTestId("section-card-experience")).toBeInTheDocument();
    expect(screen.queryByTestId("section-card-personal")).not.toBeInTheDocument();

    // Click Previous to return to Personal
    const prevBtn = screen.getByTestId("btn-nav-prev-experience");
    fireEvent.click(prevBtn);

    expect(screen.getByTestId("section-card-personal")).toBeInTheDocument();
    expect(screen.queryByTestId("section-card-experience")).not.toBeInTheDocument();

    // Click All Sections tab to view everything again
    fireEvent.click(screen.getByTestId("section-tab-all"));
    expect(screen.getByTestId("section-card-personal")).toBeInTheDocument();
    expect(screen.getByTestId("section-card-experience")).toBeInTheDocument();
    expect(screen.getByTestId("section-card-education")).toBeInTheDocument();
  });
});
