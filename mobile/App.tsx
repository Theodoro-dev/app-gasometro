import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// URL pública da API. Em produção, substitua pela URL fixa do seu servidor.
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://3000-iszvzyiut47xsx7964hqv-3575f84e.us4.manus.computer';

type Tab = 'inicio' | 'medidores' | 'trocar' | 'historico' | 'whatsapp';
type User = { id: number; email: string; local_id: number; nome_local: string; tipo_local: string };
type Nivel = {
  medidor_id: number; nome_apelido?: string; identificador_esp32: string; percentual_restante?: number;
  gas_restante_kg?: number; peso_total_kg?: number; status_nivel?: string; status_medidor?: string;
  data_hora_leitura?: string; minutos_sem_leitura?: number; capacidade_botijao_kg?: number; peso_vazio_botijao_kg?: number;
};
type Previsao = Nivel & { media_consumo_dia?: number; dias_estimados_restantes?: number; data_estimada_troca?: string };
type Alerta = { id: number; tipo: string; nome_apelido?: string; data_referencia: string; consumo_kg?: number; media_consumo_dia?: number; avisos_enviados?: number };

type ApiError = { erro?: string };

const colors = {
  bg: '#E8ECEE', card: '#FFFFFF', card2: '#F3F5F6', border: '#DDE2E6', text: '#1B1F27', muted: '#6B7280',
  green: '#2E9E44', yellow: '#F59E0B', red: '#E5384A', blue: '#3B82F6', orange: '#FF5A1F', orangeSoft: '#FFE7DD',
  dark: '#1B1F27', darkTrack: '#3A404B', track: '#E8ECEE', whatsapp: '#25d366',
};
const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
const statusLabel = (s?: string) => s === 'CRITICO' ? 'CRÍTICO' : s === 'OFFLINE' ? 'OFFLINE' : s === 'BAIXO' ? 'BAIXO' : s === 'CHEIO' ? 'CHEIO' : (s || 'SEM LEITURA');

const money = (v?: number | null, suffix = ' kg') => v === null || v === undefined ? '--' : `${Number(v).toFixed(2)}${suffix}`;
const pct = (v?: number | null) => v === null || v === undefined ? '--' : `${Math.round(Number(v))}%`;
const dateBr = (v?: string | null) => {
  if (!v) return '--'; const s = String(v).slice(0, 10); const [y, m, d] = s.split('-'); return y ? `${d}/${m}/${y}` : '--';
};
const dateTimeBr = (v?: string | null) => !v ? '--' : `${dateBr(v)} ${String(v).replace('T', ' ').slice(11, 16)}`;
const statusColor = (status?: string) => status === 'CRITICO' || status === 'OFFLINE' ? colors.red : status === 'BAIXO' ? colors.yellow : colors.green;

async function request<T>(path: string, token?: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((json as ApiError).erro || `Erro ${response.status}`);
  return json as T;
}

function Pill({ text, color = colors.green }: { text: string; color?: string }) {
  return <View style={[styles.pill, { backgroundColor: `${color}1F` }]}><Text style={[styles.pillText, { color }]}>{text}</Text></View>;
}

function Progress({ value, status }: { value?: number; status?: string }) {
  const width = `${Math.min(100, Math.max(0, Number(value) || 0))}%` as `${number}%`;
  return <View style={styles.progress}><View style={[styles.progressFill, { width, backgroundColor: statusColor(status) }]} /></View>;
}

function Arc({ size, thickness, value, color, track = colors.track, start = 0, sweep = 360, segments = 60 }: { size: number; thickness: number; value?: number; color: string; track?: string; start?: number; sweep?: number; segments?: number }) {
  const r = size / 2 - thickness / 2; const c = size / 2;
  const p = Math.min(100, Math.max(0, Number(value) || 0)); const lit = Math.round((p / 100) * segments);
  const step = sweep / (sweep >= 360 ? segments : segments - 1);
  const segLen = (Math.PI * 2 * r * (sweep / 360)) / segments + 1.5;
  return <View style={{ width: size, height: size }}>{Array.from({ length: segments }, (_, k) => { const a = start + k * step; const rad = (a * Math.PI) / 180; return <View key={k} style={{ position: 'absolute', width: segLen, height: thickness, borderRadius: 1.5, left: c + r * Math.sin(rad) - segLen / 2, top: c - r * Math.cos(rad) - thickness / 2, backgroundColor: k < lit ? color : track, transform: [{ rotate: `${a}deg` }] }} />; })}</View>;
}

function Logo({ size = 38 }: { size?: number }) {
  const arc = Math.round(size * 0.68);
  return <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' }}><View style={{ height: arc / 2 + 2, overflow: 'hidden' }}><Arc size={arc} thickness={Math.max(3, size * 0.1)} value={100} color={colors.orange} start={-90} sweep={180} segments={16} /></View></View>;
}

function Gauge({ value, status }: { value?: number; status?: string }) {
  const p = Math.min(100, Math.max(0, Number(value) || 0));
  return <View style={styles.gauge}><Arc size={72} thickness={8} value={p} color={statusColor(status)} segments={64} /><View style={styles.gaugeCenter}><Text style={styles.gaugeValue}>{Math.round(p)}%</Text></View></View>;
}

function Bars({ rows }: { rows: { data?: string; consumo_kg: number }[] }) {
  const max = Math.max(...rows.map(r => Number(r.consumo_kg) || 0), 0.01);
  return <View style={styles.bars}>{rows.map((r, k) => <View key={k} style={styles.barCol}><View style={[styles.bar, { height: Math.max(6, (Number(r.consumo_kg) / max) * 110) }]} /><Text style={styles.barLabel}>{String(r.data || '').slice(8, 10)}/{String(r.data || '').slice(5, 7)}</Text></View>)}</View>;
}

function Card({ children, style }: { children: React.ReactNode; style?: object }) { return <View style={[styles.card, style]}>{children}</View>; }
function Button({ title, onPress, secondary = false, danger = false, disabled = false }: { title: string; onPress: () => void; secondary?: boolean; danger?: boolean; disabled?: boolean }) {
  return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary, danger && styles.buttonDanger, disabled && styles.buttonDisabled, pressed && { opacity: 0.75 }]}><Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{title}</Text></Pressable>;
}
function Empty({ text }: { text: string }) { return <View style={styles.empty}><Text style={styles.emptyIcon}>◌</Text><Text style={styles.muted}>{text}</Text></View>; }

function Login({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [email, setEmail] = useState('demo@gasometro.app'); const [password, setPassword] = useState('gasometro123'); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const submit = async () => { setLoading(true); setError(''); try { const r = await request<{ token: string; usuario: User }>('/api/auth/login', undefined, 'POST', { email, senha: password }); onLogin(r.token, r.usuario); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } };
  return <SafeAreaView style={styles.loginSafe}><StatusBar barStyle="dark-content" backgroundColor={colors.bg} /><ScrollView contentContainerStyle={styles.loginContainer} keyboardShouldPersistTaps="handled">
    <View style={styles.brand}><Logo size={48} /><View><Text style={styles.brandTitle}>Gasômetro</Text><Text style={styles.brandSubtitle}>Medição de gás para o seu celular</Text></View></View>
    <Card><Text style={styles.sectionTitle}>Entrar</Text><Text style={styles.label}>E-mail</Text><TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={styles.input} /><Text style={styles.label}>Senha</Text><TextInput value={password} onChangeText={setPassword} secureTextEntry style={styles.input} />{error ? <Text style={styles.error}>{error}</Text> : null}<Button title={loading ? 'Entrando...' : 'Entrar'} onPress={submit} disabled={loading} /><Text style={styles.help}>A conta de demonstração já está preenchida. A senha do banco nunca fica dentro do aplicativo.</Text></Card>
  </ScrollView></SafeAreaView>;
}

function Header({ user, onLogout }: { user: User; onLogout: () => void }) {
  const h = new Date().getHours(); const greet = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  return <View style={styles.header}><View style={styles.headerLeft}><Logo size={42} /><View><Text style={styles.headerSubtitle}>{greet}</Text><Text style={styles.headerTitle}>{user.nome_local}</Text></View></View><Pressable onPress={onLogout} style={styles.logoutBtn}><Text style={styles.logout}>Sair</Text></Pressable></View>;
}

function Home({ token, nivel, alerts, onRefresh, onGo }: { token: string; nivel: Nivel[]; alerts: Alerta[]; onRefresh: () => Promise<void>; onGo: (tab: Tab) => void }) {
  const [previsoes, setPrevisoes] = useState<Record<number, Previsao>>({}); const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => { const rows = await Promise.all(nivel.map(m => request<Previsao>(`/api/medidores/${m.medidor_id}/previsao`, token).catch(() => ({ medidor_id: m.medidor_id } as Previsao)))); setPrevisoes(Object.fromEntries(rows.map(r => [r.medidor_id, r]))); }, [nivel, token]);
  useEffect(() => { load(); }, [load]);
  const refresh = async () => { setRefreshing(true); await onRefresh(); await load(); setRefreshing(false); };
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.orange} />}>
    <Card style={styles.notice}><View style={{ flex: 1 }}><Text style={styles.noticeTitle}>Acompanhamento em tempo real</Text><Text style={styles.muted}>Alertas de consumo e previsão de troca.</Text></View><Pill text="API OK" /></Card>
    <Text style={styles.pageTitle}>Visão geral</Text>
    {nivel.length === 0 ? <Card><Empty text="Nenhum medidor cadastrado neste local." /></Card> : <View style={styles.grid}>{nivel.map(m => { const p = previsoes[m.medidor_id] || {}; const sc = statusColor(m.status_nivel); return <Card key={m.medidor_id} style={styles.darkCard}>
      <View style={styles.rowBetween}><Text style={styles.darkTitle}>{(m.nome_apelido || m.identificador_esp32).toUpperCase()}</Text><Text style={styles.darkCode}>{m.identificador_esp32}</Text></View>
      <View style={styles.semiWrap}><Arc size={200} thickness={16} value={m.percentual_restante} color={sc} track={colors.darkTrack} start={-90} sweep={180} segments={48} /><View style={styles.semiCenter}><Text style={styles.semiValue}>{pct(m.percentual_restante)}</Text><Text style={[styles.semiLabel, { color: sc }]}>{statusLabel(m.status_nivel)}</Text></View></View>
      <View style={styles.darkDivider} />
      <View style={styles.rowBetween}><Text style={styles.darkMuted}>Autonomia estimada</Text><Text style={styles.darkValue}>{p.dias_estimados_restantes !== undefined && p.dias_estimados_restantes !== null ? `~${p.dias_estimados_restantes} dias` : 'Sem previsão'}</Text></View>
      <View style={styles.dataRows}><DataRow dark label="Gás restante" value={money(m.gas_restante_kg)} /><DataRow dark label="Média 7 dias" value={p.media_consumo_dia ? `${money(p.media_consumo_dia)}/dia` : 'Sem histórico'} /><DataRow dark label="Troca prevista" value={p.data_estimada_troca ? `${dateBr(p.data_estimada_troca)} (${p.dias_estimados_restantes}d)` : 'Sem previsão'} /></View>
      <View style={[styles.row, { marginTop: 12 }]}><Pill text={m.status_nivel || 'SEM'} color={sc} /><Pill text={m.status_medidor || 'ATIVO'} color={m.status_medidor === 'OFFLINE' ? colors.red : colors.green} /></View>
    </Card>; })}</View>}
    <View style={styles.rowBetween}><Text style={styles.sectionTitle}>Alertas recentes</Text><Pressable onPress={() => onGo('whatsapp')}><Text style={styles.link}>WhatsApp</Text></Pressable></View>
    <Card>{alerts.length ? alerts.map(a => <View key={a.id} style={styles.alertRow}><View style={{ flex: 1 }}><View style={styles.row}><Pill text={a.tipo} color={a.tipo === 'VERMELHO' ? colors.red : colors.yellow} /><Text style={styles.alertName}>{a.nome_apelido}</Text></View><Text style={styles.muted}>{dateBr(a.data_referencia)} · consumo {money(a.consumo_kg)} · média {money(a.media_consumo_dia)}</Text></View><Text style={styles.muted}>{a.avisos_enviados ? 'Avisado' : 'Pendente'}</Text></View>) : <Empty text="Nenhum alerta recente." />}</Card>
  </ScrollView>;
}
function DataRow({ label, value, dark = false }: { label: string; value: string; dark?: boolean }) { return <View style={styles.dataRow}><Text style={dark ? styles.darkMuted : styles.muted}>{label}</Text><Text style={dark ? styles.darkValue : styles.dataValue}>{value}</Text></View>; }

function Meters({ nivel, onGo }: { nivel: Nivel[]; onGo: (tab: Tab) => void }) { return <ScrollView contentContainerStyle={styles.content}><Text style={styles.pageTitle}>Botijões</Text>{nivel.length ? nivel.map(m => <Card key={m.medidor_id} style={styles.meterListCard}><View style={styles.row}>{m.percentual_restante === undefined ? null : <Gauge value={m.percentual_restante} status={m.status_nivel} />}<View style={{ flex: 1, marginLeft: m.percentual_restante === undefined ? 0 : 14, gap: 4 }}><Text style={styles.cardTitle}>{m.nome_apelido || m.identificador_esp32}</Text><Text style={styles.muted}>{m.identificador_esp32} · leitura {m.data_hora_leitura ? dateTimeBr(m.data_hora_leitura) : 'nunca'}</Text><View style={styles.row}><Pill text={m.status_nivel ? statusLabel(m.status_nivel) : 'SEM LEITURA'} color={statusColor(m.status_nivel)} /><Pill text={m.status_medidor || 'ATIVO'} color={m.status_medidor === 'OFFLINE' ? colors.red : colors.green} /></View>{m.percentual_restante === undefined ? <Text style={styles.muted}>Sem leitura ainda</Text> : <Text style={styles.dataValue}>{money(m.gas_restante_kg)}</Text>}</View></View><View style={styles.rowActions}><Button title="Registrar troca" onPress={() => onGo('trocar')} /><Button title="Ver histórico" secondary onPress={() => onGo('historico')} /></View></Card>) : <Card><Empty text="Nenhum medidor cadastrado." /></Card>}</ScrollView>; }

function Change({ token, nivel, onDone }: { token: string; nivel: Nivel[]; onDone: () => Promise<void> }) { const [selected, setSelected] = useState(nivel[0]?.medidor_id || 0); const [weight, setWeight] = useState('26.00'); const [tare, setTare] = useState('13.00'); const [loading, setLoading] = useState(false); const [modal, setModal] = useState(false); const selectedMeter = nivel.find(n => n.medidor_id === selected); const fill = () => { if (selectedMeter) { setWeight((Number(selectedMeter.capacidade_botijao_kg || 13) + Number(selectedMeter.peso_vazio_botijao_kg || 13)).toFixed(2)); setTare(Number(selectedMeter.peso_vazio_botijao_kg || 13).toFixed(2)); } };
  const submit = async () => { setLoading(true); try { await request(`/api/medidores/${selected}/trocas`, token, 'POST', { peso_botijao_novo_kg: Number(weight), tara_botijao_kg: tare ? Number(tare) : null }); Alert.alert('Troca registrada', 'O nível e a previsão foram recalculados.'); await onDone(); } catch (e) { Alert.alert('Não foi possível registrar', (e as Error).message); } finally { setLoading(false); } };
  return <ScrollView contentContainerStyle={styles.content}><Text style={styles.pageTitle}>Trocar botijão</Text><Card><Text style={styles.cardTitle}>Registrar nova troca</Text><Text style={styles.label}>Medidor</Text><Pressable style={styles.select} onPress={() => setModal(true)}><Text style={styles.inputText}>{selectedMeter?.nome_apelido || 'Selecionar medidor'}</Text><Text style={styles.muted}>⌄</Text></Pressable><Text style={styles.label}>Peso total do botijão novo (kg)</Text><TextInput value={weight} onChangeText={setWeight} keyboardType="decimal-pad" style={styles.input} /><Text style={styles.label}>Tara do botijão (kg, opcional)</Text><TextInput value={tare} onChangeText={setTare} keyboardType="decimal-pad" style={styles.input} /><View style={styles.rowActions}><Button title={loading ? 'Salvando...' : 'Confirmar troca'} onPress={submit} disabled={loading || !selected} /><Button title="Botijão cheio" secondary onPress={fill} /></View><Text style={styles.help}>O banco divide o dia da troca em trechos e recalcula consumo e previsão automaticamente.</Text></Card><Modal visible={modal} transparent animationType="fade" onRequestClose={() => setModal(false)}><Pressable style={styles.modalBackdrop} onPress={() => setModal(false)}><View style={styles.modalCard}><Text style={styles.sectionTitle}>Escolha o medidor</Text>{nivel.map(m => <Pressable key={m.medidor_id} style={styles.option} onPress={() => { setSelected(m.medidor_id); setModal(false); }}><Text style={styles.cardTitle}>{m.nome_apelido}</Text><Text style={styles.muted}>{pct(m.percentual_restante)} · {m.status_nivel}</Text></Pressable>)}</View></Pressable></Modal></ScrollView>; }

function History({ token, nivel }: { token: string; nivel: Nivel[] }) { const [selected, setSelected] = useState(nivel[0]?.medidor_id || 0); const [tab, setTab] = useState<'consumo' | 'alertas' | 'trocas'>('consumo'); const [consumo, setConsumo] = useState<any[]>([]); const [alerts, setAlerts] = useState<Alerta[]>([]); const [trocas, setTrocas] = useState<any[]>([]); useEffect(() => { if (!selected) return; Promise.all([request<any[]>(`/api/medidores/${selected}/consumo`, token), request<Alerta[]>('/api/alertas?limite=50', token), request<any[]>(`/api/medidores/${selected}/trocas`, token)]).then(([c, a, t]) => { setConsumo(c); setAlerts(a); setTrocas(t); }).catch(() => undefined); }, [selected, token]); const rows = tab === 'consumo' ? consumo : tab === 'alertas' ? alerts : trocas;
  return <ScrollView contentContainerStyle={styles.content}><Text style={styles.pageTitle}>Histórico</Text><Card><Pressable style={styles.select} onPress={() => { const i = nivel.findIndex(n => n.medidor_id === selected); setSelected(nivel[(i + 1) % Math.max(1, nivel.length)]?.medidor_id || selected); }}><Text style={styles.inputText}>{nivel.find(n => n.medidor_id === selected)?.nome_apelido || 'Medidor'}</Text><Text style={styles.muted}>Toque para alternar</Text></Pressable><View style={styles.segment}><Segment title="Consumo" active={tab === 'consumo'} onPress={() => setTab('consumo')} /><Segment title="Alertas" active={tab === 'alertas'} onPress={() => setTab('alertas')} /><Segment title="Trocas" active={tab === 'trocas'} onPress={() => setTab('trocas')} /></View>{tab === 'consumo' && consumo.filter(r => r.consumo_kg !== null && r.consumo_kg !== undefined).length > 0 ? <Bars rows={consumo.filter(r => r.consumo_kg !== null && r.consumo_kg !== undefined).slice(-7)} /> : null}{rows.length ? rows.slice().reverse().map((r, i) => <View key={r.id || r.data || i} style={styles.historyRow}>{tab === 'consumo' ? <><Text style={styles.cardTitle}>{dateBr(r.data)}</Text><Text style={styles.dataValue}>{r.consumo_kg === null ? 'Sem dados suficientes' : money(r.consumo_kg)}</Text></> : tab === 'alertas' ? <><View style={styles.row}><Pill text={r.tipo} color={r.tipo === 'VERMELHO' ? colors.red : colors.yellow} /><Text style={styles.cardTitle}>{r.nome_apelido}</Text></View><Text style={styles.muted}>{dateBr(r.data_referencia)} · consumo {money(r.consumo_kg)}</Text></> : <><Text style={styles.cardTitle}>{dateTimeBr(r.data_hora)}</Text><Text style={styles.dataValue}>{money(r.peso_botijao_novo_kg)} · tara {money(r.tara_botijao_kg)}</Text></>}</View>) : <Empty text="Nenhum registro para este medidor." />}</Card></ScrollView>; }
function Segment({ title, active, onPress }: { title: string; active: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.segmentButton, active && styles.segmentActive]}><Text style={[styles.segmentText, active && { color: '#FFFFFF' }]}>{title}</Text></Pressable>; }

function WhatsApp({ token }: { token: string }) { const [channels, setChannels] = useState<any[]>([]); const [sent, setSent] = useState<any[]>([]); const [number, setNumber] = useState('+5511999999999'); const [loading, setLoading] = useState(false); const load = () => Promise.all([request<any>('/api/canais', token), request<any>('/api/notificacoes?limite=20', token)]).then(([c, s]) => { setChannels(c.canais || []); setSent(s.envios || []); }); useEffect(() => { load().catch(() => undefined); }, []); const add = async () => { try { await request('/api/canais', token, 'POST', { tipo: 'WHATSAPP', destino: number }); Alert.alert('Canal adicionado', 'O WhatsApp está pronto para receber alertas.'); await load(); } catch (e) { Alert.alert('Erro', (e as Error).message); } }; const test = async (id: number) => { try { const r = await request<any>(`/api/canais/${id}/teste`, token, 'POST'); if (r.link_whatsapp) Linking.openURL(r.link_whatsapp); Alert.alert('Teste registrado', r.status === 'SIMULADO' ? 'Modo simulado: foi criado um link wa.me.' : 'Mensagem enviada.'); await load(); } catch (e) { Alert.alert('Erro', (e as Error).message); } }; const process = async () => { setLoading(true); try { const r = await request<any>('/api/notificacoes/processar', token, 'POST'); Alert.alert('Processamento concluído', `${r.enviados + r.simulados} aviso(s) processado(s).`); await load(); } catch (e) { Alert.alert('Erro', (e as Error).message); } finally { setLoading(false); } };
  return <ScrollView contentContainerStyle={styles.content}><Text style={styles.pageTitle}>WhatsApp</Text><Card><View style={styles.rowBetween}><Text style={styles.cardTitle}>Canais de aviso</Text><Pill text="SIMULADO" color={colors.yellow} /></View><Text style={styles.help}>No modo simulado, o app registra o alerta e gera um link wa.me. Para envio automático, configure a Meta Cloud API ou Twilio no servidor.</Text>{channels.map(c => <View key={c.id} style={styles.channelRow}><View><Text style={styles.cardTitle}>{c.tipo} · {c.destino}</Text><Text style={styles.muted}>{c.ativo ? 'Ativo' : 'Desativado'}</Text></View><Button title="Teste" onPress={() => test(c.id)} /></View>)}<Text style={styles.label}>Novo número de WhatsApp</Text><TextInput value={number} onChangeText={setNumber} keyboardType="phone-pad" style={styles.input} /><Button title="Adicionar canal" onPress={add} /></Card><Card><View style={styles.rowBetween}><View><Text style={styles.cardTitle}>Avisos enviados</Text><Text style={styles.muted}>{sent.length} registro(s)</Text></View><Button title={loading ? '...' : 'Processar agora'} secondary onPress={process} disabled={loading} /></View>{sent.length ? sent.map(e => <View key={e.id} style={styles.historyRow}><Text style={styles.cardTitle}>{e.tipo} · {e.nome_apelido}</Text><Text style={styles.muted}>{dateBr(e.data_referencia)} · {e.status} · {e.destino}</Text></View>) : <Empty text="Nenhum aviso enviado ainda." />}</Card></ScrollView>; }

function Main() {
  const insets = useSafeAreaInsets();
  const [token, setToken] = useState<string | null>(null); const [user, setUser] = useState<User | null>(null); const [tab, setTab] = useState<Tab>('inicio'); const [nivel, setNivel] = useState<Nivel[]>([]); const [alerts, setAlerts] = useState<Alerta[]>([]); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { if (!token) return; setLoading(true); try { const [n, a] = await Promise.all([request<Nivel[]>('/api/medidores/nivel', token), request<Alerta[]>('/api/alertas?limite=10', token)]); setNivel(n); setAlerts(a); } catch (e) { Alert.alert('Falha de conexão', (e as Error).message); } finally { setLoading(false); } }, [token]); useEffect(() => { load(); }, [load]); const logout = () => { setToken(null); setUser(null); setNivel([]); setAlerts([]); }; if (!token || !user) return <Login onLogin={(t, u) => { setToken(t); setUser(u); }} />;
  const content = tab === 'inicio' ? <Home token={token} nivel={nivel} alerts={alerts} onRefresh={load} onGo={setTab} /> : tab === 'medidores' ? <Meters nivel={nivel} onGo={setTab} /> : tab === 'trocar' ? <Change token={token} nivel={nivel} onDone={load} /> : tab === 'historico' ? <History token={token} nivel={nivel} /> : <WhatsApp token={token} />;
  return <SafeAreaView style={styles.app}><StatusBar barStyle="dark-content" backgroundColor={colors.bg} /><Header user={user} onLogout={logout} />{loading && <View style={styles.loadingBar}><ActivityIndicator color={colors.orange} size="small" /><Text style={styles.muted}>Atualizando...</Text></View>}{content}<View style={[styles.tabBar, { paddingBottom: 8 + insets.bottom }]}>{(['inicio', 'medidores', 'trocar', 'historico', 'whatsapp'] as Tab[]).map(t => <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}><Text style={[styles.tabIcon, tab === t && { color: colors.orange }]}>{t === 'inicio' ? '⌂' : t === 'medidores' ? '▥' : t === 'trocar' ? '⇄' : t === 'historico' ? '▤' : '◉'}</Text><Text style={[styles.tabText, tab === t && { color: colors.orange }]}>{t === 'inicio' ? 'Início' : t === 'medidores' ? 'Botijões' : t === 'trocar' ? 'Trocar' : t === 'historico' ? 'Histórico' : 'WhatsApp'}</Text></Pressable>)}</View></SafeAreaView>;
}

export default function App() {
  return <SafeAreaProvider><Main /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.bg }, loginSafe: { flex: 1, backgroundColor: colors.bg }, loginContainer: { flexGrow: 1, justifyContent: 'center', padding: 22 },
  brand: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, gap: 12 }, brandTitle: { color: colors.text, fontSize: 28, fontWeight: '800' }, brandSubtitle: { color: colors.muted, fontSize: 13 },
  header: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 }, headerTitle: { color: colors.text, fontSize: 17, fontWeight: '800' }, headerSubtitle: { color: colors.muted, fontSize: 12 }, logout: { color: colors.text, fontWeight: '700', fontSize: 12 }, logoutBtn: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  content: { padding: 16, paddingBottom: 120, gap: 14 }, card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 15, marginBottom: 14 }, notice: { backgroundColor: colors.card, flexDirection: 'row', alignItems: 'center', gap: 12 }, noticeTitle: { color: colors.text, fontWeight: '700', marginBottom: 3 }, pageTitle: { color: colors.text, fontSize: 23, fontWeight: '800', marginTop: 2 }, sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800' }, cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700' }, muted: { color: colors.muted, fontSize: 12 }, help: { color: colors.muted, fontSize: 12, marginTop: 12, lineHeight: 18 }, label: { color: colors.muted, fontSize: 11, textTransform: 'uppercase', marginTop: 13, marginBottom: 5, letterSpacing: 0.5, fontWeight: '700' }, input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, color: colors.text, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 }, inputText: { color: colors.text, fontSize: 14 }, error: { color: colors.red, backgroundColor: '#FDECEE', borderRadius: 10, padding: 10, marginTop: 12 },
  button: { backgroundColor: colors.dark, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', minWidth: 110 }, buttonSecondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }, buttonDanger: { backgroundColor: colors.red }, buttonDisabled: { opacity: 0.5 }, buttonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 }, buttonTextSecondary: { color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 7 }, rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, rowActions: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' }, link: { color: colors.orange, fontWeight: '700' }, pill: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 4 }, pillText: { fontSize: 10, fontWeight: '800' },
  grid: { gap: 0 }, medidorCard: { marginBottom: 14 }, medidorBody: { flexDirection: 'row', alignItems: 'center', marginTop: 15 }, gauge: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' }, gaugeCenter: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }, gaugeValue: { color: colors.text, fontSize: 14, fontWeight: '800', fontFamily: mono }, gaugeLabel: { color: colors.muted, fontSize: 9, marginTop: -2 }, progress: { height: 8, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.track }, progressFill: { height: '100%', borderRadius: 8 }, dataRows: { marginTop: 10, gap: 5 }, dataRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 }, dataValue: { color: colors.text, fontSize: 13, fontWeight: '700', textAlign: 'right', fontFamily: mono }, bigNumber: { color: colors.text, fontSize: 22, fontWeight: '800', marginTop: 12, fontFamily: mono },
  darkCard: { backgroundColor: colors.dark, borderColor: colors.dark, borderRadius: 20, padding: 18 }, darkTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', letterSpacing: 0.3 }, darkCode: { color: '#8A91A0', fontSize: 11, fontFamily: mono, fontWeight: '700' }, darkMuted: { color: '#A3AAB8', fontSize: 12 }, darkValue: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', textAlign: 'right', fontFamily: mono }, darkDivider: { borderTopWidth: 1, borderTopColor: '#4A505C', borderStyle: 'dashed', marginVertical: 14 },
  semiWrap: { width: 200, height: 112, overflow: 'hidden', alignSelf: 'center', marginTop: 14 }, semiCenter: { position: 'absolute', left: 0, right: 0, top: 46, alignItems: 'center' }, semiValue: { color: '#FFFFFF', fontSize: 38, fontWeight: '800' }, semiLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 1, marginTop: 2 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, marginTop: 16, paddingBottom: 4, minHeight: 140 }, barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 6 }, bar: { width: '100%', backgroundColor: colors.orange, borderRadius: 6 }, barLabel: { color: colors.muted, fontSize: 10 },
  alertRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border }, alertName: { color: colors.text, fontSize: 13, fontWeight: '600' }, meterListCard: { marginBottom: 14 }, channelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 }, historyRow: { paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 25, gap: 6 }, emptyIcon: { color: colors.muted, fontSize: 30 },
  select: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, modalBackdrop: { flex: 1, backgroundColor: '#1B1F27B3', justifyContent: 'center', padding: 22 }, modalCard: { backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16 }, option: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }, segment: { flexDirection: 'row', marginTop: 16, gap: 6, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 4 }, segmentButton: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11 }, segmentActive: { backgroundColor: colors.dark }, segmentText: { color: colors.muted, fontSize: 12, fontWeight: '700' }, loadingBar: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 16, paddingTop: 6 }, tabBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', paddingTop: 8, paddingBottom: 8 }, tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4, marginHorizontal: 2 }, tabActive: { backgroundColor: colors.orangeSoft, borderRadius: 12 }, tabIcon: { color: colors.muted, fontSize: 20 }, tabText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
});
