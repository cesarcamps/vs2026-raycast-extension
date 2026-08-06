# Visual Studio 2026 Recent Projects

Extensión para [Raycast](https://www.raycast.com/) que muestra el historial de proyectos y soluciones recientes de Visual Studio en Windows.

Importa el MRU desde `ApplicationPrivateSettings.xml`, el registro de Windows y carpetas de desarrollo. Incluye ranking híbrido por frecuencia de uso y recencia, proyectos anclados (pinned), búsqueda fuzzy, filtro por tags y apertura directa con VS Stable / Preview / Enterprise.

---

## ⚙️ Requisitos

- **Windows** (la extensión accede a rutas y registro del sistema)
- **Raycast** instalado ([descargar](https://www.raycast.com/download))
- **Visual Studio 2026** o versiones recientes (no obligatorio, pero sin VS no hay proyectos que mostrar)

---

## 📥 Instalación

### Opción 1 — Desde GitHub Releases (recomendada)

1. Ve a [Releases](https://github.com/cesarcamps/vs2026-raycast-extension/releases)
2. Descarga `visualstudio2026.raycast.zip` de la última versión
3. Extrae el contenido en una carpeta (botón derecho → **Extraer todo…**)
4. Abre Raycast y ejecuta el comando **Import Extension**
5. Selecciona la carpeta `visualstudio2026.raycast` que acabas de extraer
6. ¡Listo! La extensión aparece en Raycast

### Opción 2 — Desde el código fuente (desarrolladores)

```bash
git clone https://github.com/cesarcamps/vs2026-raycast-extension.git
cd vs2026-raycast-extension
npm install
npm run dev
```

Esto abre la extensión en modo desarrollo con hot-reload.

---

## 🚀 Uso

1. Abre Raycast (`Alt+Space` o tu atajo)
2. Busca **"VS2026 Recent Projects"**
3. Navega por tus proyectos recientes, anclados o filtrados

### Atajos y comandos

| Acción                   | Descripción                                      |
| ------------------------ | ------------------------------------------------ |
| `Enter`                  | Abre el proyecto con el editor asociado (`.sln`) |
| `⌘+P` / `Ctrl+P`         | Fijar / desfijar proyecto (pinned)               |
| `⌘+T` / `Ctrl+T`         | Editar tags del proyecto                         |
| `⌘+⇧+F` / `Ctrl+Shift+F` | Filtrar por rango de fechas (`used:last7days`)   |
| Escribir `tag:net8`      | Filtrar proyectos por tag                        |

### Filtros de búsqueda

| Filtro         | Ejemplo                                                             |
| -------------- | ------------------------------------------------------------------- |
| `tag:<nombre>` | `tag:net8 tag:web`                                                  |
| `used:<rango>` | `used:today`, `used:last7days`, `used:last30days`, `used:thisMonth` |

---

## 🧱 Características

- **Importación inteligente** desde `ApplicationPrivateSettings.xml`, registro de Windows (`ProjectMRUList`, `MRUItems`) y escaneo de carpetas
- **Ranking híbrido**: pinned + recencia + contador de aperturas
- **Agrupación por fecha**: Today, Yesterday, This Week, This Month, Earlier + sección 📌 Pinned
- **Sistema de tags**: asigna y filtra por etiquetas
- **Búsqueda fuzzy** sobre nombre de proyecto, ruta y tags
- **Apertura directa** con el manejador `.sln` predeterminado del sistema

---

## 🏗️ Build desde CI

Cada push a `main` o ejecución manual del workflow [Build & Release](https://github.com/cesarcamps/vs2026-raycast-extension/actions) genera el `.zip` listo para instalar. Los tags `v*` producen además un [GitHub Release](https://github.com/cesarcamps/vs2026-raycast-extension/releases) con el artefacto adjunto.

---

## 📄 Licencia

MIT
