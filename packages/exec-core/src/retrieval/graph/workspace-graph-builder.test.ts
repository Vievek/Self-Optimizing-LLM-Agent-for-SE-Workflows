import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkspaceGraphBuilder } from './workspace-graph-builder.js';

describe('WorkspaceGraphBuilder with Incremental Updates', () => {
  let tmpDir: string;
  let builder: WorkspaceGraphBuilder;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ast-builder-test-'));
    builder = new WorkspaceGraphBuilder();
  });

  afterEach(async () => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('scans and indexes supported JavaScript and TypeScript files', async () => {
    const authFile = path.join(tmpDir, 'authController.js');
    await fs.promises.writeFile(
      authFile,
      `
      function loginUser(req, res) {
        return res.json({ token: "xyz" });
      }

      function registerUser(req, res) {
        return res.json({ id: 1 });
      }

      module.exports = { loginUser, registerUser };
      `,
      'utf8',
    );

    const { graph, retriever, parsedFilesCount } = await builder.buildFromDirectory(tmpDir);

    expect(parsedFilesCount).toBe(1);
    expect(graph.getAllNodes().length).toBeGreaterThanOrEqual(2);

    const loginNode = graph.findNodesByName('loginUser');
    expect(loginNode.length).toBe(1);
    expect(loginNode[0]?.filePath).toBe('authController.js');

    // Query via attached retriever using symbol name
    const retrieval = retriever.retrieve({ query: 'loginUser' });
    expect(retrieval.snippets.length).toBeGreaterThanOrEqual(1);
    expect(retrieval.snippets[0]?.node.name).toBe('loginUser');

    // Query via attached retriever using filename / module query ("authController")
    const fileRetrieval = retriever.retrieve({ query: 'authController' });
    expect(fileRetrieval.snippets.length).toBeGreaterThanOrEqual(1);
    expect(fileRetrieval.snippets.some((s) => s.node.filePath === 'authController.js')).toBe(true);
  });

  it('indexes CommonJS Express export patterns (exports.register = async ...)', async () => {
    const controllerFile = path.join(tmpDir, 'projectController.js');
    await fs.promises.writeFile(
      controllerFile,
      `
      exports.getProjects = async (req, res) => {
        return res.json([]);
      };

      exports.createProject = async (req, res) => {
        return res.json({ id: 1 });
      };
      `,
      'utf8',
    );

    const { retriever, graph } = await builder.buildFromDirectory(tmpDir);

    const getProjectsNode = graph.findNodesByName('getProjects');
    expect(getProjectsNode.length).toBe(1);
    expect(getProjectsNode[0]?.kind).toBe('function');

    // Retrieve via module name
    const res = retriever.retrieve({ query: 'projectController' });
    expect(res.snippets.length).toBeGreaterThanOrEqual(2);
    expect(res.snippets.some((s) => s.node.name === 'getProjects')).toBe(true);
    expect(res.snippets.some((s) => s.node.name === 'createProject')).toBe(true);
  });

  it('performs incremental delta update when a file is modified', async () => {
    const filePath = 'authController.js';
    const initialCode = `
      function loginUser(req, res) {
        return res.json({ token: "xyz" });
      }
    `;

    const { graph } = await builder.buildFromDirectory(tmpDir);

    // 1. Initial indexing of the file
    builder.updateFile(filePath, initialCode, graph, tmpDir);
    expect(graph.findNodesByName('loginUser').length).toBe(1);
    expect(graph.findNodesByName('updateUser').length).toBe(0);

    // 2. Incremental update: modify file to add updateUser
    const updatedCode = `
      function loginUser(req, res) {
        return res.json({ token: "xyz" });
      }

      function updateUser(req, res) {
        return res.json({ updated: true });
      }
    `;

    const updated = builder.updateFile(filePath, updatedCode, graph, tmpDir);
    expect(updated).toBe(true);

    // Graph now contains updateUser without restarting or re-indexing other files
    expect(graph.findNodesByName('updateUser').length).toBe(1);
    expect(graph.findNodesByName('loginUser').length).toBe(1);
  });

  it('indexes Mongoose Models and Schemas and bridges backend models with frontend components on query', async () => {
    // 1. Create backend Mongoose Model file
    const modelsDir = path.join(tmpDir, 'server', 'models');
    await fs.promises.mkdir(modelsDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(modelsDir, 'Project.js'),
      `
      const mongoose = require('mongoose');
      const ProjectSchema = new mongoose.Schema({
        title: { type: String, required: true },
        owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      });
      module.exports = mongoose.model('Project', ProjectSchema);
      `,
      'utf8',
    );

    // 2. Create frontend React component file
    const clientDir = path.join(tmpDir, 'client', 'src', 'components');
    await fs.promises.mkdir(clientDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(clientDir, 'ProjectDetail.js'),
      `
      export const ProjectDetail = ({ project }) => {
        return <div>{project.name}</div>;
      };
      `,
      'utf8',
    );

    const { retriever, graph } = await builder.buildFromDirectory(tmpDir);

    // Verify model node exists with extracted schema fields
    const projectModelNode = graph.findNodesByName('Project');
    expect(projectModelNode.length).toBeGreaterThanOrEqual(1);
    expect(projectModelNode[0]?.kind).toBe('class');
    expect(projectModelNode[0]?.docstring).toContain('fields: title, owner');

    // Verify React component node exists with rendered props
    const detailNode = graph.findNodesByName('ProjectDetail')[0];
    expect(detailNode?.docstring).toContain('renders: project.name');

    // Retrieve by "Project" query
    const results = retriever.retrieve({ query: 'Project' });
    expect(results.snippets.length).toBeGreaterThanOrEqual(2);

    // Both backend model AND frontend component are returned in the AST context
    expect(results.snippets.some((s) => s.node.filePath.includes('Project.js'))).toBe(true);
    expect(results.snippets.some((s) => s.node.filePath.includes('ProjectDetail.js'))).toBe(true);
  });

  it('persists graph cache to .soa_graph.json and reloads instantly with delta updates', async () => {
    // 1. Initial build: should build and save .soa_graph.json
    const initial = await builder.buildFromDirectory(tmpDir);
    expect(initial.fromCache).toBe(false);

    const cachePath = path.join(tmpDir, '.soa_graph.json');
    expect(fs.existsSync(cachePath)).toBe(true);

    // 2. Second build: should load directly from cache with 0 reindexed files
    const cached = await builder.buildFromDirectory(tmpDir);
    expect(cached.fromCache).toBe(true);
    expect(cached.reindexedFilesCount).toBe(0);

    // 3. Modify a file: should incrementally update only that file
    const targetFile = path.join(tmpDir, 'math.ts');
    await fs.promises.writeFile(targetFile, 'export function add(a: number, b: number) { return a + b + 1; }');

    const updated = await builder.buildFromDirectory(tmpDir);
    expect(updated.fromCache).toBe(true);
    expect(updated.reindexedFilesCount).toBe(1);
    expect(updated.graph.findNodesByName('add').length).toBe(1);
  });
});

