using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Forcome.AgentSetup
{
    internal static class Program
    {
        internal const string ServerAddress = "192.168.16.70";
        internal const int ServerPort = 10051;

        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
        }
    }

    internal sealed class SetupForm : Form
    {
        private readonly Button installButton;
        private readonly Label statusLabel;
        private readonly ProgressBar progressBar;

        internal SetupForm()
        {
            Text = "Forcome Windows 监控客户端";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ClientSize = new Size(520, 330);
            BackColor = Color.FromArgb(244, 246, 243);
            Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular, GraphicsUnit.Point);

            Panel header = new Panel();
            header.Dock = DockStyle.Top;
            header.Height = 92;
            header.BackColor = Color.FromArgb(27, 30, 32);
            Controls.Add(header);

            Label mark = new Label();
            mark.Text = "F";
            mark.TextAlign = ContentAlignment.MiddleCenter;
            mark.Font = new Font("Segoe UI", 21F, FontStyle.Bold);
            mark.ForeColor = Color.FromArgb(27, 30, 32);
            mark.BackColor = Color.White;
            mark.SetBounds(24, 23, 46, 46);
            header.Controls.Add(mark);

            Label title = new Label();
            title.Text = "Forcome Windows 监控客户端";
            title.Font = new Font("Microsoft YaHei UI", 14F, FontStyle.Bold);
            title.ForeColor = Color.White;
            title.AutoSize = true;
            title.Location = new Point(88, 22);
            header.Controls.Add(title);

            Label subtitle = new Label();
            subtitle.Text = "安装后自动接入服务器监控";
            subtitle.ForeColor = Color.FromArgb(177, 184, 188);
            subtitle.AutoSize = true;
            subtitle.Location = new Point(90, 55);
            header.Controls.Add(subtitle);

            AddInfoRow("设备名称", Environment.MachineName, 122);
            AddInfoRow("监控服务器", Program.ServerAddress + ":" + Program.ServerPort, 162);
            AddInfoRow("采集内容", "在线状态、CPU、内存、磁盘", 202);

            progressBar = new ProgressBar();
            progressBar.SetBounds(24, 244, 472, 5);
            progressBar.Style = ProgressBarStyle.Marquee;
            progressBar.MarqueeAnimationSpeed = 25;
            progressBar.Visible = false;
            Controls.Add(progressBar);

            statusLabel = new Label();
            statusLabel.Text = "准备安装";
            statusLabel.ForeColor = Color.FromArgb(100, 108, 114);
            statusLabel.AutoSize = false;
            statusLabel.TextAlign = ContentAlignment.MiddleLeft;
            statusLabel.SetBounds(24, 272, 300, 34);
            Controls.Add(statusLabel);

            installButton = new Button();
            installButton.Text = "开始安装";
            installButton.FlatStyle = FlatStyle.Flat;
            installButton.FlatAppearance.BorderSize = 0;
            installButton.BackColor = Color.FromArgb(31, 35, 38);
            installButton.ForeColor = Color.White;
            installButton.SetBounds(366, 270, 130, 38);
            installButton.Click += InstallButtonClick;
            Controls.Add(installButton);
        }

        private void AddInfoRow(string name, string value, int top)
        {
            Label nameLabel = new Label();
            nameLabel.Text = name;
            nameLabel.ForeColor = Color.FromArgb(103, 111, 117);
            nameLabel.AutoSize = false;
            nameLabel.SetBounds(24, top, 100, 26);
            Controls.Add(nameLabel);

            Label valueLabel = new Label();
            valueLabel.Text = value;
            valueLabel.Font = new Font(Font, FontStyle.Bold);
            valueLabel.ForeColor = Color.FromArgb(32, 35, 38);
            valueLabel.AutoEllipsis = true;
            valueLabel.SetBounds(132, top, 364, 26);
            Controls.Add(valueLabel);
        }

        private void InstallButtonClick(object sender, EventArgs e)
        {
            installButton.Enabled = false;
            progressBar.Visible = true;
            statusLabel.Text = "正在检查监控服务器...";

            BackgroundWorker worker = new BackgroundWorker();
            worker.DoWork += delegate(object workerSender, DoWorkEventArgs args)
            {
                args.Result = InstallAgent();
            };
            worker.RunWorkerCompleted += delegate(object workerSender, RunWorkerCompletedEventArgs args)
            {
                progressBar.Visible = false;
                installButton.Enabled = true;
                if (args.Error != null)
                {
                    statusLabel.Text = "安装失败";
                    MessageBox.Show(args.Error.Message, "Forcome 安装失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                statusLabel.Text = "安装成功，设备正在接入";
                installButton.Text = "完成";
                installButton.Click -= InstallButtonClick;
                installButton.Click += delegate { Close(); };
                MessageBox.Show(
                    (string)args.Result,
                    "Forcome 安装完成",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            };
            worker.RunWorkerAsync();
        }

        private static string InstallAgent()
        {
            if (!Environment.Is64BitOperatingSystem)
                throw new InvalidOperationException("当前安装包仅支持 64 位 Windows。");

            if (!CanConnect(Program.ServerAddress, Program.ServerPort, 5000))
                throw new InvalidOperationException(
                    "无法连接监控服务器 " + Program.ServerAddress + ":" + Program.ServerPort +
                    "。请确认电脑位于公司网络，并联系管理员检查防火墙。");

            string tempDirectory = Path.Combine(Path.GetTempPath(), "Forcome-Agent-" + Guid.NewGuid().ToString("N"));
            string msiPath = Path.Combine(tempDirectory, "zabbix_agent2.msi");
            string dataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Forcome");
            string logPath = Path.Combine(dataDirectory, "agent-install.log");
            Directory.CreateDirectory(tempDirectory);
            Directory.CreateDirectory(dataDirectory);

            try
            {
                ExtractAgent(msiPath);
                string productName = Convert.ToString(Registry.GetValue(
                    @"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion",
                    "ProductName",
                    "Windows"));
                string metadata = productName.IndexOf("Server", StringComparison.OrdinalIgnoreCase) >= 0
                    ? "Forcome-Windows-Server"
                    : "Forcome-Windows-Workstation";

                string arguments = string.Format(
                    "/i \"{0}\" /qn /norestart SERVER=\"{1}\" SERVERACTIVE=\"{1}:{2}\" " +
                    "HOSTNAME=\"{3}\" HOSTMETADATA=\"{4}\" STARTUPTYPE=delayed /L*v \"{5}\"",
                    msiPath,
                    Program.ServerAddress,
                    Program.ServerPort,
                    Environment.MachineName,
                    metadata,
                    logPath);

                ProcessStartInfo startInfo = new ProcessStartInfo("msiexec.exe", arguments);
                startInfo.UseShellExecute = false;
                startInfo.CreateNoWindow = true;
                Process process = Process.Start(startInfo);
                process.WaitForExit();
                if (process.ExitCode != 0 && process.ExitCode != 3010)
                    throw new InvalidOperationException(
                        "Windows 安装程序返回错误 " + process.ExitCode + "。详细日志：" + logPath);

                StartAgentService();
                return "设备 " + Environment.MachineName + " 已完成安装。\n\n" +
                       "请等待 1～2 分钟，它会自动出现在 Forcome Ops 主机列表中。";
            }
            finally
            {
                try { Directory.Delete(tempDirectory, true); }
                catch { }
            }
        }

        private static void ExtractAgent(string destination)
        {
            Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream("ForcomeAgent.msi");
            if (input == null)
                throw new InvalidOperationException("安装包内部缺少 Agent 2 文件。");

            using (input)
            using (FileStream output = File.Create(destination))
            {
                input.CopyTo(output);
            }
        }

        private static bool CanConnect(string host, int port, int timeoutMilliseconds)
        {
            using (TcpClient client = new TcpClient())
            {
                IAsyncResult result = client.BeginConnect(host, port, null, null);
                WaitHandle waitHandle = result.AsyncWaitHandle;
                try
                {
                    if (!waitHandle.WaitOne(timeoutMilliseconds, false)) return false;
                    client.EndConnect(result);
                    return true;
                }
                catch
                {
                    return false;
                }
                finally
                {
                    waitHandle.Close();
                }
            }
        }

        private static void StartAgentService()
        {
            ProcessStartInfo startInfo = new ProcessStartInfo("sc.exe", "start \"Zabbix Agent 2\"");
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            Process process = Process.Start(startInfo);
            process.WaitForExit(10000);
        }
    }
}
