import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ResumeForm from "../ResumeForm";
import { getDefaultResumeData } from "../../utils/templateEngine";
import { ResumeData } from "../../types";

describe("ResumeForm component", () => {
  const initialData: ResumeData = getDefaultResumeData("Taylor Swift");

  beforeAll(() => {
    // jsdom doesn't implement scrolling
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("shows every section on one page with a nav that jumps between them", () => {
    render(<ResumeForm data={initialData} onChange={vi.fn()} />);

    for (const key of ["personal", "experience", "education", "projects", "skills", "custom"]) {
      expect(screen.getByTestId(`section-card-${key}`)).toBeInTheDocument();
      expect(screen.getByTestId(`section-tab-${key}`)).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { level: 2, name: "Experience" })).toBeInTheDocument();
    expect(screen.getByTestId("section-tab-experience")).toHaveTextContent("Experience, 2");

    expect(screen.getByTestId("section-tab-personal")).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByTestId("section-tab-skills"));
    expect(screen.getByTestId("section-tab-skills")).toHaveAttribute("aria-current", "true");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("reorders content sections but keeps Details first", () => {
    const onChange = vi.fn();
    render(<ResumeForm data={initialData} onChange={onChange} />);

    expect(screen.queryByTestId("btn-move-section-up-personal")).not.toBeInTheDocument();
    expect(screen.getByTestId("btn-move-section-up-experience")).toBeDisabled();

    fireEvent.click(screen.getByTestId("btn-move-section-up-education"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionOrder: ["personal", "education", "experience", "projects", "skills", "custom"],
      })
    );
  });

  it("starts a new highlight on Enter and removes an empty one on Backspace", () => {
    const onChange = vi.fn();
    const data: ResumeData = {
      ...initialData,
      experience: [{ id: "e1", role: "Dev", company: "Co", bullets: ["Shipped it", ""] }],
    };
    render(<ResumeForm data={data} onChange={onChange} />);

    fireEvent.keyDown(screen.getAllByLabelText("Highlight 1")[0], { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ experience: [expect.objectContaining({ bullets: ["Shipped it", "", ""] })] })
    );

    fireEvent.keyDown(screen.getAllByLabelText("Highlight 2")[0], { key: "Backspace" });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ experience: [expect.objectContaining({ bullets: ["Shipped it"] })] })
    );
  });

  it("turns pasted line breaks in a highlight into spaces", () => {
    const onChange = vi.fn();
    render(<ResumeForm data={initialData} onChange={onChange} />);
    fireEvent.change(screen.getAllByLabelText("Highlight 1")[0], { target: { value: "Line one\nline two" } });
    expect(onChange.mock.calls[0][0].experience[0].bullets[0]).toBe("Line one line two");
  });

  it("can always add an additional section", () => {
    const onChange = vi.fn();
    render(<ResumeForm data={{ ...initialData, customSections: [] }} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("btn-add-custom-section"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ customSections: [expect.objectContaining({ title: "", bullets: [""] })] })
    );
  });

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

  it("does not show contact-field reorder arrows (templates fix the contact order)", () => {
    render(<ResumeForm data={initialData} onChange={vi.fn()} />);
    expect(screen.queryByTestId("btn-move-personal-phone-up")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-move-personal-location-down")).not.toBeInTheDocument();
  });

  it("associates every field label with its input", () => {
    render(<ResumeForm data={initialData} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Full name")).toHaveValue("Taylor Swift");
    expect(screen.getByLabelText("Email")).toHaveValue(initialData.personal.email);
    expect(screen.getAllByLabelText("Role")[0]).toHaveValue(initialData.experience[0].role);
    expect(screen.getAllByLabelText("Highlight 1")[0]).toHaveValue(initialData.experience[0].bullets[0]);
  });

  it("asks before removing an entry that has content", () => {
    const onChange = vi.fn();
    const confirmSpy = vi.mocked(window.confirm);
    confirmSpy.mockReturnValueOnce(false);
    render(<ResumeForm data={initialData} onChange={onChange} />);

    fireEvent.click(screen.getByTestId("btn-remove-experience-0"));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(screen.getByTestId("btn-remove-experience-0"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ experience: [initialData.experience[1]] })
    );
  });

  it("removes an empty entry without asking", () => {
    const onChange = vi.fn();
    const confirmSpy = vi.mocked(window.confirm);
    confirmSpy.mockClear();
    const data: ResumeData = {
      ...initialData,
      experience: [{ id: "blank", role: "", company: "", bullets: [""] }],
    };
    render(<ResumeForm data={data} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("btn-remove-experience-0"));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ experience: [] }));
  });

  it("edits bullet points of custom sections", () => {
    const onChange = vi.fn();
    const data: ResumeData = {
      ...initialData,
      customSections: [{ id: "sec-1", title: "Awards", content: "", bullets: ["Dean's List"] }],
    };
    render(<ResumeForm data={data} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Awards bullet 1"), { target: { value: "Valedictorian" } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        customSections: [expect.objectContaining({ bullets: ["Valedictorian"] })],
      })
    );

    fireEvent.click(screen.getByTestId("btn-add-custom-bullet-0"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        customSections: [expect.objectContaining({ bullets: ["Dean's List", ""] })],
      })
    );
  });

  it("locks the form and offers to regenerate when the LaTeX source was edited by hand", () => {
    const onChange = vi.fn();
    const onRegenerate = vi.fn();
    const onOpenSource = vi.fn();
    render(
      <ResumeForm
        data={{ ...initialData, sourceEditedManually: true }}
        onChange={onChange}
        locked
        onRegenerateFromForm={onRegenerate}
        onOpenSource={onOpenSource}
      />
    );

    expect(screen.getByTestId("form-locked-banner")).toBeInTheDocument();
    expect(screen.getByTestId("input-personal-name")).toBeDisabled();
    expect(screen.getByTestId("btn-add-experience")).toBeDisabled();

    fireEvent.click(screen.getByText("Edit LaTeX source"));
    expect(onOpenSource).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("btn-regenerate-from-form"));
    expect(onRegenerate).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("allows reordering experience entries and reflects on experience items", () => {
    const onChange = vi.fn();
    render(<ResumeForm data={initialData} onChange={onChange} />);

    expect(initialData.experience.length).toBeGreaterThanOrEqual(2);
    // Move second experience entry up
    const moveExpUp = screen.getByTestId("btn-move-experience-up-1");
    fireEvent.click(moveExpUp);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        experience: [
          initialData.experience[1],
          initialData.experience[0],
        ],
      })
    );
  });

  it("keeps stationary fields fixed without reorder arrows across experience, education, projects, and skills", () => {
    render(<ResumeForm data={initialData} onChange={vi.fn()} />);

    // Stationary fields in entries must NOT have reorder arrows
    expect(screen.queryByTestId("btn-move-experience-company-up")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-move-experience-role-up")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-move-education-degree-up")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-move-education-institution-up")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-move-project-name-up")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-move-skill-category-up")).not.toBeInTheDocument();

    // Entries themselves can still be reordered
    expect(screen.getByTestId("btn-move-experience-up-1")).toBeInTheDocument();
    expect(screen.getByTestId("btn-move-experience-down-0")).toBeInTheDocument();
  });

  it("allows reordering bullets within an experience entry", () => {
    const onChange = vi.fn();
    render(<ResumeForm data={initialData} onChange={onChange} />);

    const expId = initialData.experience[0].id;
    // Move second bullet up
    const moveBulletUp = screen.getByTestId(`btn-move-exp-bullet-up-${expId}-1`);
    fireEvent.click(moveBulletUp);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        experience: expect.arrayContaining([
          expect.objectContaining({
            id: expId,
            bullets: [
              initialData.experience[0].bullets[1],
              initialData.experience[0].bullets[0],
              ...initialData.experience[0].bullets.slice(2),
            ],
          }),
        ]),
      })
    );
  });
});
