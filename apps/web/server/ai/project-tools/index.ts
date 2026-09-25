import { createToolKit, type ToolContext } from "./shared";
import { buildProjectStateTools } from "./project-state";
import { buildVerifyTools } from "./verify";
import { buildCodeTools } from "./code";
import { buildElectronicsTools } from "./electronics";
import { buildCadTools } from "./cad";
import { buildRenderTools } from "./render";

export type { ToolContext } from "./shared";
export { withToolLogging } from "./shared";

/**
 * Tool set exposed to the AI copilot. Every tool runs the same capability
 * checks and audit logging as the human tRPC mutations — the model is just
 * another (fully attributed) actor. Failures are returned as strings so the
 * model can explain them instead of crashing the stream.
 */
export function buildProjectTools(ctx: ToolContext) {
  const kit = createToolKit(ctx);
  const all = {
    ...buildProjectStateTools(ctx, kit),
    ...buildVerifyTools(ctx, kit),
    ...buildCodeTools(ctx, kit),
    ...buildElectronicsTools(ctx, kit),
    ...buildCadTools(ctx, kit),
    ...buildRenderTools(ctx, kit),
  };
  // The original declaration order, which is the order the model sees the
  // tools in. Grouping them into modules must not reshuffle that.
  return {
    get_project_state: all.get_project_state,
    update_brief: all.update_brief,
    add_requirements: all.add_requirements,
    add_components: all.add_components,
    remove_requirements: all.remove_requirements,
    remove_components: all.remove_components,
    remove_validation_checks: all.remove_validation_checks,
    delete_code_file: all.delete_code_file,
    clear_circuit: all.clear_circuit,
    extract_product_images: all.extract_product_images,
    save_circuit: all.save_circuit,
    import_wokwi_diagram: all.import_wokwi_diagram,
    define_part_models: all.define_part_models,
    check_integration: all.check_integration,
    clear_pcb: all.clear_pcb,
    save_pcb: all.save_pcb,
    create_cad_component: all.create_cad_component,
    delete_cad_component: all.delete_cad_component,
    text_to_cad: all.text_to_cad,
    save_cad_script: all.save_cad_script,
    patch_cad_script: all.patch_cad_script,
    python_cad: all.python_cad,
    add_part_to_assembly: all.add_part_to_assembly,
    generate_concept_image: all.generate_concept_image,
    render_model_views: all.render_model_views,
    render_circuit: all.render_circuit,
    render_pcb: all.render_pcb,
    add_repo_link: all.add_repo_link,
    add_validation_checks: all.add_validation_checks,
    write_code_file: all.write_code_file,
    request_review: all.request_review,
  };
}
