// Use public capabilities rather than private methods or kernel version strings.
function toolApi(tools) {
  if (typeof tools?.schemas !== 'function' || typeof tools.execute !== 'function') {
    throw new Error('当前 DSH 内核的工具接口不兼容，请更新连接插件后重试。');
  }
  return typeof tools.setExecutor === 'function' ? 'batch' : 'single';
}

export function peerToolSchemas(tools, agent) {
  toolApi(tools);
  return tools.schemas(agent).filter(tool =>
    !tool.name.startsWith('peer_') && tool.name !== 'run_code' &&
    // New kernels exclude conditional tools outside their admitted model step.
    (typeof tools.executable !== 'function' || tools.executable(tool.name, agent) !== undefined));
}

export async function executePeerTool(tools, input) {
  const api = toolApi(tools);
  input.signal.throwIfAborted();
  let result;
  if (api === 'batch') {
    const argumentsJson = JSON.stringify(input.arguments === undefined ? {} : input.arguments);
    if (argumentsJson === undefined) throw new Error('联动工具参数必须可序列化为 JSON。');
    const batch = await tools.execute({
      calls: [{ type: 'tool-call', id: input.callId, name: input.name, arguments: argumentsJson }],
      agent: input.agent, signal: input.signal,
    });
    if (!Array.isArray(batch?.results) || batch.results.length !== 1 || batch.results[0].callId !== input.callId) {
      throw new Error('DSH 内核返回了不兼容的工具批次结果；操作可能已执行，请先核对结果，不要自动重试。');
    }
    result = batch.results[0].result;
  } else {
    result = await tools.execute(input);
  }
  // Never retry with another signature: a rejected or malformed call may have side effects.
  if (!Array.isArray(result?.content) || typeof result.isError !== 'boolean') {
    throw new Error('DSH 内核返回了不兼容的工具结果；操作可能已执行，请先核对结果，不要自动重试。');
  }
  return result;
}
