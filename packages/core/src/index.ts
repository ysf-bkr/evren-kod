/**
 * Evren motoru — tek giriş kapısı (barrel).
 *
 * VS Code'dan bağımsızdır: sağlayıcılar, araçlar, izin motoru, bağlam
 * yönetimi, bilgi tabanı ve çağrı grafiği burada yaşar. Eklenti ve CLI bu
 * paketi `@evren-kod/core/...` alt yollarıyla kullanır; kök dışa aktarımlar
 * keşif içindir, derin yollar kararlı API'dir.
 */
export * from './shared/types';
export * from './shared/errors';
export * from './shared/constants';
export * from './shared/commandPolicy';
export * from './shared/toolLabels';
export * from './providers';
export * from './tools';
export * from './core/snapshot/SnapshotManager';
export * from './core/concurrency/FileLockManager';
export * from './core/spec/TraceabilityManager';
export * from './core/team/TeamPresenceManager';
export * from './core/tasks/TaskQueueManager';
export * from './core/cicd/ReleasePipelineManager';
export * from './core/lifecycle/TechDebtTracker';
export * from './core/lifecycle/MigrationManager';
export * from './core/metrics/MetricsCollector';
export * from './core/governance/EnterpriseGovernance';
export * from './core/sandbox/ContainerSandbox';
export * from './core/telemetry/TelemetryExporter';
export * from './core/team/TeamCoordinationServer';
export * from './core/integrations/IssueTrackerConnector';
export * from './core/knowledge/SemanticCodeIndex';
export * from './core/fastapply/FastApplyEngine';
export * from './core/optimization';
export * from './core/settings/SettingsStorage';
export * from './core/agent/TerminalAgent';
