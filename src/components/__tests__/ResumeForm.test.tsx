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

  it("allows reordering sections in the visual form", () => {
    const onChange = vi.fn();
    render(<ResumeForm data={initialData} onChange={onChange} />);

    // Click Move Up on the Experience section
    const moveExpUpBtn = screen.getByTestId("btn-move-section-up-experience");
    fireEvent.click(moveExpUpBtn);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionOrder: ["experience", "personal", "education", "projects", "skills"],
      })
    );
  });

  it("allows reordering items in the personal info section (e.g. moving location and phone)", () => {
    const onChange = vi.fn();
    render(<ResumeForm data={initialData} onChange={onChange} />);

    // Stationary fields must NOT have reorder arrows
    expect(screen.queryByTestId("btn-move-personal-name-up")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-move-personal-title-up")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-move-personal-summary-up")).not.toBeInTheDocument();

    // Move phone up (initially at index 1 after email)
    const movePhoneUp = screen.getByTestId("btn-move-personal-phone-up");
    fireEvent.click(movePhoneUp);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        personalFieldOrder: expect.arrayContaining(["phone", "email"]),
      })
    );

    // Move location down
    const moveLocationDown = screen.getByTestId("btn-move-personal-location-down");
    fireEvent.click(moveLocationDown);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        personalFieldOrder: expect.any(Array),
      })
    );
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
